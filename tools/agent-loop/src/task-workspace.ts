// Отдельный checkout задачи: рабочие файлы не смешиваются с веткой этапа.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { backoff, readStatus, type LoopContext, type Step } from './context.ts';
import { head, isAncestor, makeGit } from './git.ts';
import { statusBranch } from './stage-file.ts';

export interface TaskWorkspace {
  readonly context: LoopContext;
  readonly root: string;
}

function workspacePath(root: string, task: string, base: string): string {
  const parent = resolve(dirname(root), `${basename(root)}-agent-workspaces`);
  const path = resolve(parent, `${task.replaceAll('/', '-')}-${base.slice(0, 12)}`);
  if (!path.startsWith(`${parent}${sep}`)) throw new Error(`Недопустимый путь задачи: ${path}`);
  return path;
}

async function registered(context: LoopContext, path: string): Promise<boolean> {
  const entries = await context.git.run(['worktree', 'list', '--porcelain']);
  return entries
    .split(/\r?\n/u)
    .some(
      (line) =>
        line.startsWith('worktree ') && resolve(line.slice(9)).toLowerCase() === path.toLowerCase(),
    );
}

/** Создаёт или восстанавливает checkout задачи, оставляя state.json и журнал у оркестратора. */
export async function taskWorkspace(
  context: LoopContext,
  task: string,
): Promise<TaskWorkspace | Step> {
  const mainRoot = context.config.stateRoot ?? context.config.root;
  const base = context.state.activeTask?.base ?? (await head(context.git));
  const root = context.state.activeTask?.workspaceRoot ?? workspacePath(mainRoot, task, base);
  const branch = statusBranch(await readStatus(mainRoot));
  if (branch === undefined) return backoff(context, `${task}: ветка этапа не указана в STATUS`, '');
  const exists = await stat(root).then(
    () => true,
    () => false,
  );
  if (exists && !(await registered(context, root)))
    return backoff(context, `${task}: путь checkout существует вне Git worktree: ${root}`, '');
  if (!exists) {
    await mkdir(dirname(root), { recursive: true });
    const added = await context.git.attempt(['worktree', 'add', '--detach', root, base]);
    if (added.code !== 0)
      return backoff(context, `${task}: не удалось создать checkout`, added.stderr.trim());
  }
  const readyFile = join(root, '.ai-logs', 'agent-loop', 'deps-ready');
  const dependenciesReady = await stat(readyFile).then(
    () => true,
    () => false,
  );
  if (!dependenciesReady) {
    const installed = await context.config.runCommand('pnpm', ['install', '--frozen-lockfile'], {
      cwd: root,
      timeoutMs: 10 * 60_000,
    });
    if (installed.code !== 0)
      return backoff(
        context,
        `${task}: не удалось установить зависимости checkout`,
        installed.stderr,
      );
    await mkdir(dirname(readyFile), { recursive: true });
    await writeFile(readyFile, base, 'utf8');
  }
  if (!exists) await context.say(`${task}: создан отдельный checkout ${root}`);
  const taskGit = makeGit(context.config.runCommand, root, branch);
  if (!(await isAncestor(taskGit, base, 'HEAD')))
    return backoff(context, `${task}: checkout не содержит исходный коммит ${base}`, '');
  const workspace: LoopContext = {
    ...context,
    config: { ...context.config, root, stateRoot: mainRoot },
    git: taskGit,
  };
  return { context: workspace, root };
}

/** После публикации задачи подтягивает точный HEAD ветки этапа в чистый каталог оркестратора. */
export async function promoteWorkspace(
  context: LoopContext,
  task: string,
  workspace: TaskWorkspace,
): Promise<Step | undefined> {
  const branch = workspace.context.git.targetBranch;
  if (branch === undefined) throw new Error('У checkout задачи нет ветки публикации');
  const fetched = await context.git.attempt(['fetch', 'origin', branch]);
  if (fetched.code !== 0)
    return backoff(context, `${task}: не удалось обновить ${branch} после CI`, fetched.stderr);
  const expected = await head(workspace.context.git);
  const published = await context.git.run(['rev-parse', `origin/${branch}`]);
  if (published !== expected && !(await isAncestor(workspace.context.git, expected, published)))
    return backoff(context, `${task}: origin/${branch} разошёлся с проверенным HEAD`, '');
  const merged = await context.git.attempt(['merge', '--ff-only', expected]);
  if (merged.code !== 0)
    return backoff(context, `${task}: каталог этапа разошёлся с ${branch}`, merged.stderr);
  if ((await head(context.git)) !== expected)
    return backoff(context, `${task}: опубликованный HEAD не совпал с checkout задачи`, '');
  await context.say(`${task}: проверенный HEAD перенесён в каталог этапа`);
  return undefined;
}
