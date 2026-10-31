// Git для цикла: подтянуть ветку перед сессией и убедиться, что результат сессии запушен.
import type { CommandResult, RunCommand } from './process.ts';

export interface Git {
  /** Команда должна пройти, иначе исключение с stderr. */
  readonly run: (args: readonly string[]) => Promise<string>;
  /** Команда, у которой ненулевой код — ответ, а не сбой (`merge-base --is-ancestor`). */
  readonly attempt: (args: readonly string[]) => Promise<CommandResult>;
  /** Ветка этапа для отдельного checkout задачи; по умолчанию текущая ветка. */
  readonly targetBranch?: string;
}

export function makeGit(runCommand: RunCommand, root: string, targetBranch?: string): Git {
  const attempt = (args: readonly string[]) => runCommand('git', args, { cwd: root });
  return {
    attempt,
    ...(targetBranch === undefined ? {} : { targetBranch }),
    async run(args) {
      const result = await attempt(args);
      if (result.code !== 0)
        throw new Error(result.stderr.trim() || `git ${args.join(' ')} завершился с ошибкой`);
      return result.stdout.trim();
    },
  };
}

export const currentBranch = (git: Git): Promise<string> => git.run(['branch', '--show-current']);
export const publishBranch = async (git: Git): Promise<string> =>
  git.targetBranch ?? currentBranch(git);
export const head = (git: Git): Promise<string> => git.run(['rev-parse', 'HEAD']);
/** SHA опубликованной ветки без сетевого запроса; fetch до начала задачи обновляет этот ref. */
export async function remoteHead(git: Git): Promise<string> {
  const branch = await publishBranch(git);
  const result = await git.attempt(['rev-parse', `origin/${branch}`]);
  return result.code === 0 ? result.stdout.trim() : '';
}
/** @returns вывод `git status --porcelain`; пустая строка — дерево чистое. */
export const dirtyFiles = (git: Git): Promise<string> => git.run(['status', '--porcelain']);

/** @returns пути из `git status --porcelain`, по одному на файл (без слияния каталогов). */
export async function changedPaths(git: Git): Promise<string[]> {
  const status = await git.run(['status', '--porcelain', '--untracked-files=all']);
  return status
    .split(/\r?\n/)
    .map((line) => line.replace(/^[ MADRCU?!]{1,2}\s+/, '').replace(/^.* -> /, ''))
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

export const isAncestor = async (
  git: Git,
  ancestor: string,
  descendant: string,
): Promise<boolean> =>
  (await git.attempt(['merge-base', '--is-ancestor', ancestor, descendant])).code === 0;

/** Пересоздаёт проверенное дерево поверх собственного опубликованного коммита после красного CI. */
export async function reparentReviewedCommit(
  git: Git,
  published: string,
  source: string,
): Promise<string | undefined> {
  if ((await dirtyFiles(git)) !== '') return 'рабочее дерево не чистое';
  const sourceTree = await git.run(['rev-parse', `${source}^{tree}`]);
  if (sourceTree === (await git.run(['rev-parse', `${published}^{tree}`])))
    return 'исправленный коммит не меняет содержимое опубликованного HEAD';
  const reset = await git.attempt(['reset', '--soft', published]);
  if (reset.code !== 0) return reset.stderr.trim() || 'git reset --soft не прошёл';
  const committed = await git.attempt(['commit', '-C', source]);
  if (committed.code !== 0) {
    await git.attempt(['reset', '--soft', source]);
    return committed.stderr.trim() || 'git commit не прошёл';
  }
  const current = await head(git);
  if (
    (await git.run(['rev-parse', `${current}^{tree}`])) !== sourceTree ||
    (await git.run(['rev-parse', `${current}^`])) !== published ||
    (await dirtyFiles(git)) !== ''
  ) {
    await git.attempt(['reset', '--soft', source]);
    return 'пересобранный коммит отличается от проверенного дерева';
  }
  return undefined;
}

/**
 * Сводит локальную ветку с origin: отстала — fast-forward, ушла вперёд — push,
 * разошлась — rebase поверх origin и push. Конфликт rebase откатывается.
 * @returns undefined при успехе или причина остановки.
 */
export async function syncWithOrigin(git: Git, push: boolean): Promise<string | undefined> {
  const branch = await publishBranch(git);
  const fetched = await git.attempt(['fetch', 'origin', branch]);
  // Ветки ещё нет в origin (новая ветка потока или этапа): сводить не с чем — опубликовать.
  if (fetched.code !== 0 && /couldn't find remote ref/i.test(fetched.stderr)) {
    if (!push) return undefined;
    const published = await git.attempt(['push', '-u', 'origin', `HEAD:${branch}`]);
    return published.code === 0
      ? undefined
      : `push новой ветки ${branch} не прошёл: ${published.stderr}`;
  }
  if (fetched.code !== 0) throw new Error(fetched.stderr.trim() || `git fetch origin ${branch}`);
  const local = await head(git);
  const remote = await git.run(['rev-parse', `origin/${branch}`]);
  if (local === remote) return undefined;
  if (await isAncestor(git, local, remote)) {
    await git.run(['merge', '--ff-only', `origin/${branch}`]);
    return undefined;
  }
  if (!(await isAncestor(git, remote, local))) {
    const rebase = await git.attempt(['rebase', `origin/${branch}`]);
    if (rebase.code !== 0) {
      await git.attempt(['rebase', '--abort']);
      return `локальные коммиты конфликтуют с origin/${branch}: rebase откатан`;
    }
  }
  if (!push) return undefined;
  const pushed = await git.attempt(['push', 'origin', `HEAD:${branch}`]);
  return pushed.code === 0 ? undefined : `push в origin/${branch} не прошёл: ${pushed.stderr}`;
}

/** @returns true, если HEAD ветки этапа уже лежит в origin/main (PR этапа смёржен). */
export async function mergedIntoMain(git: Git): Promise<boolean> {
  await git.run(['fetch', 'origin', 'main']);
  if (await isAncestor(git, 'HEAD', 'origin/main')) return true;
  // Squash-мерж не оставляет коммитов ветки в main, но дерево main совпадает с HEAD.
  return (await git.attempt(['diff', '--quiet', 'HEAD', 'origin/main'])).code === 0;
}
