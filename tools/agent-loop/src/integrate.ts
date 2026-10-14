// Очередь слияния: задача потока после `$review` OK вливается в ветку этапа так, что та всегда
// зелёная — свежая ветка этапа вливается в ветку задачи, CI на слитом дереве, потом fast-forward.
import { backoff, park, runSkill, save, waitCi, type LoopContext, type Step } from './context.ts';
import { dirtyFiles, head, isAncestor, syncWithOrigin, type Git } from './git.ts';
import { outsideScope, taskScope, workFiles } from './scope.ts';
import { taskBlock } from './stage-file.ts';
import { ciFixPrompt, runReview, skillFailed } from './tasks.ts';
import type { Lock } from './worktree.ts';

/** Главный каталог на ветке этапа: в него вливает только диспетчер, под общим замком. */
export interface StageTarget {
  readonly context: LoopContext;
  readonly branch: string;
  readonly lock: Lock;
  /** Ветка этапа сдвинута на влитую задачу (вызывается под замком, сразу после push). */
  readonly onMerged?: (sha: string) => void;
}
/** Итог слияния: влито, задачу вернули на работу (`ВОЗВРАТ` повторного ревью) или шаг цикла. */
export type Integration = 'merged' | 'rework' | { readonly step: Step };

/** Сколько раз за задачу цикл сам разрешает конфликт или чинит красный CI после слияния. */
const MAX_REPAIRS = 2;
/** Через сколько повторить слияние, пока в главном каталоге работа владельца, мс. */
const DIRTY_RETRY_MS = 2 * 60_000;
/** Сколько раз подряд ветка этапа может уйти вперёд, пока задача ждёт CI. */
const MAX_ATTEMPTS = 6;

const names = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export const mergeMessage = (task: string, stageBranch: string): string =>
  `chore(infra): ветка ${stageBranch} влита в задачу ${task}\n\nЭтап: ${task}`;

export const mergePrompt = (task: string, stageBranch: string): string =>
  `$task ${task} слияние: влей origin/${stageBranch} в текущую ветку (git merge origin/${stageBranch}), разреши конфликты по смыслу обеих сторон, pnpm verify --changed, коммит слияния с трейлером «Этап: ${task}», push. Эталоны visual в конфликте — pnpm visual --update на слитом дереве, пути PNG — в отчёт задачи.`;

export const reReviewNote = (reason: string): string =>
  `Повторное ревью после слияния ветки этапа: ${reason}. Отметка задачи уже [x]: при OK её не меняй и коммит не делай; при ВОЗВРАТ — [ ] и docs-коммит, как обычно.`;

/**
 * Вливает свежую ветку этапа в ветку задачи.
 * @returns причина повторного ревью ('' — не нужно), шаг цикла при остановке.
 */
async function mergeStage(
  context: LoopContext,
  task: string,
  stageBranch: string,
  repairs: { count: number },
): Promise<string | { readonly step: Step }> {
  const { git } = context;
  const base = `origin/${stageBranch}`;
  if (await isAncestor(git, base, 'HEAD')) return '';
  const fork = await git.run(['merge-base', 'HEAD', base]);
  const mine = names(await git.run(['diff', '--name-only', `${fork}..HEAD`]));
  const theirs = new Set(names(await git.run(['diff', '--name-only', `${fork}..${base}`])));
  const shared = workFiles(mine).filter((path) => theirs.has(path));
  const merged = await git.attempt([
    'merge',
    '--no-ff',
    '-m',
    mergeMessage(task, stageBranch),
    base,
  ]);
  if (merged.code === 0)
    return shared.length === 0
      ? ''
      : `ветка этапа за время задачи меняла те же файлы: ${shared.join(', ')}`;
  await git.attempt(['merge', '--abort']);
  repairs.count += 1;
  if (repairs.count > MAX_REPAIRS)
    return {
      step: await park(
        context,
        `merge:${task}`,
        `${task}: снова конфликт слияния с ${stageBranch} — нужен владелец`,
      ),
    };
  await context.say(`${task}: конфликт слияния с ${stageBranch} — разрешает отдельная сессия`);
  const prompt = mergePrompt(task, stageBranch);
  const result = await runSkill(context, 'next', prompt);
  if (!result.ok) return { step: await skillFailed(context, prompt, result) };
  if (!(await isAncestor(git, base, 'HEAD')))
    return {
      step: await park(
        context,
        `merge:${task}`,
        `${task}: после сессии слияния ${base} не влит — проверь`,
        result.message,
      ),
    };
  return `конфликт слияния разрешён сессией (${shared.join(', ') || 'файлы этапа'})`;
}

/**
 * Fast-forward ветки этапа на проверенный HEAD задачи, под замком главного каталога.
 * @returns 'merged', 'moved' — ветка этапа ушла вперёд (нужно слить снова), 'dirty' — в главном
 * каталоге работа владельца, или причина ожидания.
 */
async function fastForward(target: StageTarget, sha: string): Promise<string> {
  return target.lock.run(async () => {
    const main = target.context.git;
    if ((await dirtyFiles(main)) !== '') return 'dirty';
    const unsynced = await syncWithOrigin(main, true);
    if (unsynced !== undefined) return unsynced;
    if (!(await isAncestor(main, 'HEAD', sha))) return 'moved';
    await main.run(['merge', '--ff-only', sha]);
    const pushed = await main.attempt(['push', 'origin', target.branch]);
    if (pushed.code !== 0) {
      await main.run(['reset', '--hard', `origin/${target.branch}`]);
      return 'moved';
    }
    // CI запускается по хэшу: прогон на ветке задачи — это CI того же HEAD ветки этапа.
    target.context.state.greenHead = sha;
    await save(target.context);
    target.onMerged?.(sha);
    return 'merged';
  });
}

/** Объём: файлы задачи вне её `Файлы:` — в протокол, ревью видит их строкой запроса. */
async function scopeNote(
  context: LoopContext,
  git: Git,
  task: string,
  stageText: string,
  stageBranch: string,
): Promise<string> {
  const fork = await git.run(['merge-base', 'HEAD', `origin/${stageBranch}`]);
  // Без добавленных файлов: новые тесты и модули задачи не могут задеть чужую работу.
  const changed = names(await git.run(['diff', '--name-only', '--diff-filter=a', `${fork}..HEAD`]));
  const outside = outsideScope(taskScope(taskBlock(stageText, task)), changed);
  if (outside.length === 0) return '';
  await context.say(`${task}: файлы вне «Файлы:» — ${outside.join(', ')}`);
  return `файлы вне «Файлы:» задачи: ${outside.join(', ')}`;
}

/**
 * Задача потока с `[x]` в своей ветке — в ветку этапа. Повторное ревью — после конфликта,
 * после слияния тех же файлов и после исправления CI; красный CI чинит сессия потока.
 */
export async function integrate(
  context: LoopContext,
  target: StageTarget,
  task: string,
  stageText: string,
): Promise<Integration> {
  const { git } = context;
  const repairs = { count: 0 };
  let review = await scopeNote(context, git, task, stageText, target.branch);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await target.lock.run(() => git.run(['fetch', 'origin', target.branch]));
    const merged = await mergeStage(context, task, target.branch, repairs);
    if (typeof merged !== 'string') return merged;
    review = [review, merged].filter(Boolean).join('; ');
    if (review !== '') {
      const verdict = await runReview(context, task, reReviewNote(review));
      if (typeof verdict === 'string') return { step: verdict };
      if (verdict.mark === ' ') return 'rework';
      review = '';
    }
    const unsynced = await syncWithOrigin(git, true);
    if (unsynced !== undefined) return { step: await park(context, `sync:${task}`, unsynced) };
    const sha = await head(git);
    if (context.state.greenHead !== sha) {
      const ci = await waitCi(context, `слияния ${task}`);
      if (ci.verdict === 'unknown')
        return { step: await backoff(context, `CI ${task} не проверен: ${ci.line}`, '') };
      if (ci.verdict === 'red') {
        repairs.count += 1;
        if (repairs.count > MAX_REPAIRS)
          return {
            step: await park(
              context,
              `ci:${task}`,
              `${task}: CI после слияния снова красный — нужен владелец`,
            ),
          };
        const prompt = ciFixPrompt(task, ci.line);
        const fixed = await runSkill(context, 'next', prompt);
        if (!fixed.ok) return { step: await skillFailed(context, prompt, fixed) };
        review = 'код исправлен после красного CI на слитом дереве';
        continue;
      }
    }
    const result = await fastForward(target, sha);
    if (result === 'merged') return 'merged';
    if (result === 'dirty') {
      // Работа владельца в главном каталоге кончается без коммита: повтор по времени, не по HEAD.
      context.state.retryAfter = context.config.now() + DIRTY_RETRY_MS;
      await save(context);
      await context.say(`${task} ждёт слияния: главный каталог не чистый (работа владельца)`);
      return { step: 'idle' };
    }
    if (result !== 'moved')
      return { step: await park(context, `ff:${task}`, `${task} ждёт слияния: ${result}`) };
    await context.say(`${task}: ветка ${target.branch} ушла вперёд — сливаю снова`);
  }
  return {
    step: await park(
      context,
      `ff:${task}`,
      `${task}: ветка ${target.branch} всё время уходит вперёд — проверь`,
    ),
  };
}
