import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { promotePending, runWorkspaceTask } from './agent-loop.ts';
import { save, type LoopContext } from './context.ts';
import { head, makeGit, mergedIntoMain, remoteHead, syncWithOrigin, type Git } from './git.ts';
import { defaultRunCommand } from './process.ts';
import { loadState } from './state.ts';
import { promoteWorkspace, taskWorkspace } from './task-workspace.ts';

const roots: string[] = [];

/** Настоящий git: origin — голый репозиторий, два клона — ПК владельца и «чужой» push. */
async function repos(): Promise<{
  readonly mine: Git;
  readonly other: Git;
  readonly dirs: string[];
}> {
  const root = await mkdtemp(join(tmpdir(), 'hexfront-git-'));
  roots.push(root);
  const bare = join(root, 'origin.git');
  const mine = join(root, 'mine');
  const other = join(root, 'other');
  const shell = makeGit(defaultRunCommand, root);
  await shell.run(['init', '--bare', '-b', 'main', bare]);
  await shell.run(['clone', bare, mine]);
  const gitMine = makeGit(defaultRunCommand, mine);
  for (const args of [
    ['config', 'user.email', 'loop@test'],
    ['config', 'user.name', 'loop'],
    ['config', 'core.hooksPath', 'no-hooks'],
    ['commit', '--allow-empty', '-m', 'init'],
    ['push', 'origin', 'main'],
    ['checkout', '-b', 'stage-06'],
    ['push', '-u', 'origin', 'stage-06'],
  ])
    await gitMine.run(args);
  await shell.run(['clone', '-b', 'stage-06', bare, other]);
  const gitOther = makeGit(defaultRunCommand, other);
  await gitOther.run(['config', 'user.email', 'other@test']);
  await gitOther.run(['config', 'user.name', 'other']);
  await gitOther.run(['config', 'core.hooksPath', 'no-hooks']);
  return { mine: gitMine, other: gitOther, dirs: [mine, other] };
}

async function commitFile(git: Git, dir: string, file: string, text: string): Promise<void> {
  await writeFile(join(dir, file), text);
  await git.run(['add', file]);
  await git.run(['commit', '-m', file]);
}

async function workspaceRepo(onCodex?: (cwd: string, role: string) => Promise<string>): Promise<{
  readonly mine: Git;
  readonly other: Git;
  readonly root: string;
  readonly otherRoot: string;
  readonly context: LoopContext;
}> {
  const { mine, other, dirs } = await repos();
  const root = dirs[0] ?? '';
  const otherRoot = dirs[1] ?? '';
  await mkdir(join(root, 'docs/stages'), { recursive: true });
  await writeFile(
    join(root, 'docs/STATUS.md'),
    '| Текущий этап | 06 — тест |\n| Ветка | `stage-06` |\nОчередь: 06/T1j5\n',
  );
  await writeFile(
    join(root, 'docs/stages/stage-06-test.md'),
    '# Этап 06\n\n- [ ] **T1j5. Тестовая задача**.\n  *Приёмка:* тесты.\n',
  );
  await writeFile(join(root, '.gitignore'), '.ai-logs/\nnode_modules/\n');
  await mine.run(['add', 'docs', '.gitignore']);
  await mine.run(['commit', '-m', 'status']);
  const command: typeof defaultRunCommand = async (name, args, options) => {
    if (name === 'pnpm') return { code: 0, stdout: 'success https://ci/task', stderr: '' };
    if (name === 'codex' && onCodex !== undefined) {
      if (options?.cwd === undefined) throw new Error('codex не получил cwd');
      const stdout = await onCodex(options.cwd, options.env?.AGENT_ROLE ?? '');
      return { code: 0, stdout, stderr: '' };
    }
    return defaultRunCommand(name, args, options);
  };
  const context: LoopContext = {
    config: {
      root,
      runCommand: command,
      maxRounds: 1,
      maxMinutes: 1,
      pollSeconds: 1,
      pollMinutes: 1,
      once: true,
      dryRun: false,
      now: Date.now,
      sleep: async () => 'timer',
      writeLine: () => {},
    },
    definitions: {
      roles: { next: { reasoningEffort: 'medium' }, review: { reasoningEffort: 'medium' } },
      reviewerPaths: [],
      specPaths: [],
      planPaths: [],
    },
    git: makeGit(command, root),
    state: await loadState(root),
    say: async () => {},
  };
  return { mine, other, root, otherRoot, context };
}

afterEach(async () => {
  // На Windows только что завершённый git ещё секунды держит файлы: без повторов rm падает EBUSY.
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  );
});

// Тест запускает 15–20 настоящих процессов git; на Windows каждый идёт через cmd и стоит
// сотни миллисекунд, поэтому 5 с по умолчанию проверяли бы скорость ПК, а не код
// (2026-10-14: $stage-close 06 остановился на таймауте). Предел — защита от зависания.
describe('сведение ветки с origin на настоящем git', { timeout: 60_000 }, () => {
  it('передаёт сообщение коммита с пробелами одним аргументом', async () => {
    const { mine } = await repos();
    await mine.run([
      'commit',
      '--allow-empty',
      '-m',
      'docs(docs): завершена 07/T17ap',
      '-m',
      'Этап: 07/T17ap',
    ]);
    expect(await mine.run(['log', '-1', '--pretty=%B'])).toBe(
      'docs(docs): завершена 07/T17ap\n\nЭтап: 07/T17ap',
    );
  });

  it('отставшую ветку подтягивает, ушедшую вперёд пушит', async () => {
    const { mine, other, dirs } = await repos();
    await commitFile(other, dirs[1] ?? '', 'a.txt', 'a');
    await other.run(['push', 'origin', 'stage-06']);
    expect(await syncWithOrigin(mine, true)).toBeUndefined();
    expect(await head(mine)).toBe(await head(other));
    await commitFile(mine, dirs[0] ?? '', 'b.txt', 'b');
    expect(await syncWithOrigin(mine, true)).toBeUndefined();
    expect(await mine.run(['rev-parse', 'origin/stage-06'])).toBe(await head(mine));
  });

  it('публикует HEAD отдельного checkout в ветку этапа, не меняя checkout оркестратора', async () => {
    const { mine, dirs } = await repos();
    const taskDir = join(dirname(dirs[0] ?? ''), 'task-checkout');
    const base = await head(mine);
    await mine.run(['worktree', 'add', '--detach', taskDir, base]);
    const task = makeGit(defaultRunCommand, taskDir, 'stage-06');
    await commitFile(task, taskDir, 'task.txt', 'готово');

    expect(await remoteHead(task)).toBe(base);
    expect(await syncWithOrigin(task, true)).toBeUndefined();
    expect(await head(mine)).toBe(base);
    await mine.run(['fetch', 'origin', 'stage-06']);
    expect(await mine.run(['rev-parse', 'origin/stage-06'])).toBe(await head(task));
    await mine.run(['merge', '--ff-only', 'origin/stage-06']);
    expect(await head(mine)).toBe(await head(task));
  });

  it('сохраняет состояние задачи в каталоге оркестратора и продвигает только проверенный HEAD', async () => {
    const { mine, root, context } = await workspaceRepo();
    const result = await taskWorkspace(context, '06/T1j5');
    if (typeof result === 'string') throw new Error('checkout не создан');
    const base = await head(mine);
    await commitFile(result.context.git, result.root, 'task.txt', 'готово');
    result.context.state.activeTask = {
      task: '06/T1j5',
      base,
      workspaceRoot: result.root,
      workPrompt: '$task 06/T1j5',
      phase: 'review',
      findings: [],
    };
    await save(result.context);
    expect((await loadState(root)).activeTask?.workspaceRoot).toBe(result.root);
    expect(await head(mine)).toBe(base);
    expect(await syncWithOrigin(result.context.git, true)).toBeUndefined();
    expect(
      await promoteWorkspace(context, '06/T1j5', result, await head(result.context.git)),
    ).toBeUndefined();
    expect(await head(mine)).toBe(await head(result.context.git));
  });

  it('первую рабочую сессию запускает в checkout задачи и не загрязняет каталог этапа', async () => {
    const { mine, context } = await workspaceRepo(async (cwd, role) => {
      if (role === 'reviewer')
        return '{"outcome":"ВОЗВРАТ","findings":[{"kind":"КОД","basis":"diff","text":"нет проверки"}]}';
      const taskGit = makeGit(defaultRunCommand, cwd);
      await commitFile(taskGit, cwd, 'task.txt', 'новый механизм');
      return 'Работа закоммичена';
    });
    const base = await head(mine);

    expect(await runWorkspaceTask(context, '06/T1j5', ' ', '$task 06/T1j5')).toBe('worked');
    const active = context.state.activeTask;
    expect(active?.workspaceRoot).toBeDefined();
    expect(active?.base).toBe(base);
    expect(await head(mine)).toBe(base);
    expect(await head(makeGit(defaultRunCommand, active?.workspaceRoot ?? ''))).not.toBe(base);
  });

  it('после незакоммиченного патча продолжает ту же задачу в её checkout', async () => {
    let calls = 0;
    const { mine, context } = await workspaceRepo(async (cwd, role) => {
      if (role === 'reviewer') return '{"outcome":"OK","findings":[]}';
      calls += 1;
      if (calls === 1) {
        await writeFile(join(cwd, 'task.txt'), 'незакоммиченный патч');
        return 'Работа не закончена';
      }
      const taskGit = makeGit(defaultRunCommand, cwd);
      await taskGit.run(['add', 'task.txt']);
      await taskGit.run(['commit', '-m', 'task']);
      return 'Работа закоммичена';
    });
    const base = await head(mine);

    expect(await runWorkspaceTask(context, '06/T1j5', ' ', '$task 06/T1j5')).toBe('worked');
    expect(context.state.activeTask?.workDirtyPaths).toContain('task.txt');
    expect(await runWorkspaceTask(context, '06/T1j5', ' ', '$task 06/T1j5')).toBe('worked');
    expect(calls).toBe(2);
    expect(await head(mine)).toBe(base);
    expect(
      await head(makeGit(defaultRunCommand, context.state.activeTask?.workspaceRoot ?? '')),
    ).not.toBe(base);
  });

  it('проводит задачу через код, review, CI и перенос без общего рабочего дерева', async () => {
    let workCalls = 0;
    const { mine, context } = await workspaceRepo(async (cwd, role) => {
      if (role === 'reviewer') return '{"outcome":"OK","findings":[]}';
      workCalls += 1;
      const taskGit = makeGit(defaultRunCommand, cwd);
      await commitFile(taskGit, cwd, 'task.txt', 'новый механизм');
      return 'Работа закоммичена';
    });
    const base = await head(mine);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await runWorkspaceTask(context, '06/T1j5', ' ', '$task 06/T1j5');
      if (context.state.activeTask === undefined && context.state.pendingPromotion === undefined)
        break;
    }
    expect(workCalls).toBe(1);
    expect(context.state.activeTask).toBeUndefined();
    expect(context.state.pendingPromotion).toBeUndefined();
    expect(await head(mine)).not.toBe(base);
    expect(await mine.run(['show', 'HEAD:task.txt'])).toBe('новый механизм');
  });

  it('завершает задачу в отдельном checkout и восстанавливает каталог этапа', async () => {
    const { mine, context } = await workspaceRepo();
    const { state } = context;
    const workspace = await taskWorkspace(context, '06/T1j5');
    if (typeof workspace === 'string') throw new Error('checkout не создан');
    const base = await head(mine);
    await commitFile(workspace.context.git, workspace.root, 'task.txt', 'готово');
    state.activeTask = {
      task: '06/T1j5',
      base,
      workspaceRoot: workspace.root,
      workPrompt: '$task 06/T1j5',
      phase: 'docs-ci',
      findings: [],
      codeHead: base,
    };
    await save(context);

    expect(await runWorkspaceTask(context, '06/T1j5', ' ', '$task 06/T1j5')).toBe('worked');
    expect(state.activeTask).toBeUndefined();
    expect(state.pendingPromotion).toBeUndefined();
    expect(await head(mine)).toBe(await head(workspace.context.git));
  });

  it('после обрыва между CI и переносом возобновляет продвижение без повторной задачи', async () => {
    const { mine, root, context } = await workspaceRepo();
    const { state } = context;
    const workspace = await taskWorkspace(context, '06/T1j5');
    if (typeof workspace === 'string') throw new Error('checkout не создан');
    await commitFile(workspace.context.git, workspace.root, 'task.txt', 'готово');
    await syncWithOrigin(workspace.context.git, true);
    state.pendingPromotion = {
      task: '06/T1j5',
      workspaceRoot: workspace.root,
      branch: 'stage-06',
      head: await head(workspace.context.git),
    };
    await save(context);

    expect(await promotePending(context)).toBeUndefined();
    expect((await loadState(root)).pendingPromotion).toBeUndefined();
    expect(await head(mine)).toBe(await head(workspace.context.git));
  });

  it('после CI переносит сохранённый SHA, даже если checkout задачи получил новый коммит', async () => {
    const { mine, root, context } = await workspaceRepo();
    const workspace = await taskWorkspace(context, '06/T1j5');
    if (typeof workspace === 'string') throw new Error('checkout не создан');
    await commitFile(workspace.context.git, workspace.root, 'task.txt', 'проверено');
    await syncWithOrigin(workspace.context.git, true);
    const verifiedHead = await head(workspace.context.git);
    context.state.pendingPromotion = {
      task: '06/T1j5',
      workspaceRoot: workspace.root,
      branch: 'stage-06',
      head: verifiedHead,
    };
    await save(context);
    await commitFile(workspace.context.git, workspace.root, 'later.txt', 'не проверено');
    await syncWithOrigin(workspace.context.git, true);

    expect(await promotePending({ ...context, state: await loadState(root) })).toBeUndefined();
    expect(await head(mine)).toBe(verifiedHead);
    expect(await head(mine)).not.toBe(await head(workspace.context.git));
  });

  it('переносит проверенный HEAD без следующего чужого коммита origin', async () => {
    const { mine, other, otherRoot, context } = await workspaceRepo();
    const workspace = await taskWorkspace(context, '06/T1j5');
    if (typeof workspace === 'string') throw new Error('checkout не создан');
    await commitFile(workspace.context.git, workspace.root, 'task.txt', 'готово');
    await syncWithOrigin(workspace.context.git, true);
    await other.run(['pull', '--ff-only', 'origin', 'stage-06']);
    await commitFile(other, otherRoot, 'foreign.txt', 'чужое');
    await other.run(['push', 'origin', 'stage-06']);
    const mainHead = await head(mine);

    expect(
      await promoteWorkspace(context, '06/T1j5', workspace, await head(workspace.context.git)),
    ).toBeUndefined();
    expect(await head(mine)).toBe(await head(workspace.context.git));
    expect(await head(mine)).not.toBe(mainHead);
    expect(await head(mine)).not.toBe(await head(other));
  });

  it('не переносит расходящуюся историю origin вместо проверенного HEAD', async () => {
    const { mine, other, otherRoot, context } = await workspaceRepo();
    const workspace = await taskWorkspace(context, '06/T1j5');
    if (typeof workspace === 'string') throw new Error('checkout не создан');
    await commitFile(workspace.context.git, workspace.root, 'task.txt', 'готово');
    await syncWithOrigin(workspace.context.git, true);
    await commitFile(other, otherRoot, 'foreign.txt', 'чужое');
    await other.run(['push', '--force', 'origin', 'stage-06']);
    const mainHead = await head(mine);

    expect(
      await promoteWorkspace(context, '06/T1j5', workspace, await head(workspace.context.git)),
    ).toBe('idle');
    expect(await head(mine)).toBe(mainHead);
  });

  it('разошедшуюся ветку ставит поверх origin и пушит', async () => {
    const { mine, other, dirs } = await repos();
    await commitFile(other, dirs[1] ?? '', 'a.txt', 'a');
    await other.run(['push', 'origin', 'stage-06']);
    await commitFile(mine, dirs[0] ?? '', 'b.txt', 'b');
    expect(await syncWithOrigin(mine, true)).toBeUndefined();
    await other.run(['pull', '--ff-only', 'origin', 'stage-06']);
    expect(await head(other)).toBe(await head(mine));
  });

  it('при конфликте откатывает rebase и называет причину', async () => {
    const { mine, other, dirs } = await repos();
    await commitFile(other, dirs[1] ?? '', 'same.txt', 'чужое');
    await other.run(['push', 'origin', 'stage-06']);
    await commitFile(mine, dirs[0] ?? '', 'same.txt', 'моё');
    const before = await head(mine);
    expect(await syncWithOrigin(mine, true)).toMatch(/rebase откатан/);
    expect(await head(mine)).toBe(before);
    expect(await mine.run(['status', '--porcelain'])).toBe('');
  });

  it('видит обычный и squash-мерж ветки этапа в main', async () => {
    const { mine, dirs } = await repos();
    expect(await mergedIntoMain(mine)).toBe(true);
    await commitFile(mine, dirs[0] ?? '', 'report.md', 'этап закрыт');
    expect(await mergedIntoMain(mine)).toBe(false);
    await mine.run(['checkout', 'main']);
    await mine.run(['merge', '--squash', 'stage-06']);
    await mine.run(['commit', '-m', 'squash']);
    await mine.run(['push', 'origin', 'main']);
    await mine.run(['checkout', 'stage-06']);
    expect(await mergedIntoMain(mine)).toBe(true);
  });
});
