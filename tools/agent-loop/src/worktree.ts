// Каталоги потоков: постоянный git worktree на поток рядом с репозиторием, ветка `agent/NN-Tn` на задачу.
import { access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { currentBranch, dirtyFiles, makeGit, type Git } from './git.ts';
import type { RunCommand } from './process.ts';
import { MAX_STREAMS } from './state.ts';

/**
 * Каталог потока: `<репозиторий>-streams/wN` рядом с репозиторием. Короткий путь — из-за
 * предела 260 символов на Windows и глубоких путей pnpm в node_modules.
 */
export const slotDir = (root: string, slot: number): string =>
  join(dirname(root), `${basename(root)}-streams`, `w${slot}`);

/** `07/T2` → `agent/07-T2`. */
export const agentBranch = (task: string): string => `agent/${task.replace('/', '-')}`;

/** `agent/07-T2` → `07/T2`; другая ветка — undefined. */
export const branchTask = (branch: string): string | undefined => {
  const match = branch.match(/^agent\/(\d{2})-(T\S+)$/);
  return match ? `${match[1]}/${match[2]}` : undefined;
};

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/** Очередь: следующая функция стартует, когда закончилась предыдущая (и при её ошибке). */
export interface Lock {
  readonly run: <T>(action: () => Promise<T>) => Promise<T>;
}
export function createLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(action: () => Promise<T>): Promise<T> {
      const result = tail.then(action, action);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

/** @returns git каталога потока или undefined, если каталога ещё нет. */
export async function slotGit(
  runCommand: RunCommand,
  root: string,
  slot: number,
): Promise<Git | undefined> {
  const dir = slotDir(root, slot);
  return (await exists(join(dir, '.git'))) ? makeGit(runCommand, dir) : undefined;
}

/**
 * Каталог потока на ветке задачи от свежей ветки этапа. Каталог создаётся один раз и потом
 * переиспользуется: `pnpm install` в нём идёт из общего хранилища и почти ничего не качает.
 * Ветка задачи, уже начатая раньше (перезапуск цикла), не пересоздаётся.
 */
export async function checkoutTask(
  main: Git,
  runCommand: RunCommand,
  root: string,
  slot: number,
  task: string,
  stageBranch: string,
): Promise<Git> {
  const dir = slotDir(root, slot);
  if (!(await exists(join(dir, '.git'))))
    await main.run(['worktree', 'add', '--detach', dir, `origin/${stageBranch}`]);
  const git = makeGit(runCommand, dir);
  const branch = agentBranch(task);
  if ((await currentBranch(git)) !== branch) {
    const dirty = await dirtyFiles(git);
    if (dirty !== '') throw new Error(`каталог потока ${dir} не чистый: ${dirty.split('\n')[0]}`);
    const known = (await main.attempt(['rev-parse', '--verify', '--quiet', branch])).code === 0;
    await git.run(
      known ? ['checkout', branch] : ['checkout', '-b', branch, `origin/${stageBranch}`],
    );
  }
  const install = await runCommand('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], {
    cwd: dir,
    timeoutMs: 15 * 60_000,
  });
  if (install.code !== 0)
    throw new Error(`pnpm install в ${dir}: ${install.stderr.trim().split('\n').at(-1) ?? ''}`);
  return git;
}

/**
 * Поток свободен: каталог отцепляется от ветки задачи, ветка удаляется локально и в origin.
 * `discard` — отбросить незакоммиченное (задача отменена); иначе дерево уже чистое.
 */
export async function releaseSlot(
  main: Git,
  git: Git,
  task: string,
  discard: boolean,
): Promise<void> {
  const branch = agentBranch(task);
  if (discard) {
    await git.run(['reset', '--hard']);
    await git.run(['clean', '-fd']);
  }
  await git.run(['checkout', '--detach']);
  await main.attempt(['branch', '-D', branch]);
  await main.attempt(['push', 'origin', '--delete', branch]);
}

/** @returns есть ли каталог потока на ветке задачи: начатую в потоке работу доделывают потоки. */
export async function streamWorkLeft(runCommand: RunCommand, root: string): Promise<boolean> {
  for (let slot = 1; slot <= MAX_STREAMS; slot += 1) {
    const git = await slotGit(runCommand, root, slot);
    if (git !== undefined && branchTask(await currentBranch(git)) !== undefined) return true;
  }
  return false;
}
