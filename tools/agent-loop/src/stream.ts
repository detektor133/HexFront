// Один поток: задача в своём каталоге и ветке — работа, CI, `$review` и очередь слияния.
import { rm } from 'node:fs/promises';

import { readStage, StreamCancelled, type LoopContext, type Step } from './context.ts';
import { dirtyFiles, head, isAncestor, syncWithOrigin } from './git.ts';
import { integrate, mergeMessage, type StageTarget } from './integrate.ts';
import { taskMark } from './stage-file.ts';
import { loadState, statePath } from './state.ts';
import { processTask } from './tasks.ts';
import { agentBranch, checkoutTask, releaseSlot, slotDir } from './worktree.ts';

/** Итог запуска потока; `parked` и `backoff` держат поток за задачей до нового коммита или паузы. */
export type StreamOutcome =
  | { readonly kind: 'merged' }
  | { readonly kind: 'cancelled'; readonly reason: string }
  | { readonly kind: 'parked'; readonly reason: string }
  | { readonly kind: 'backoff'; readonly until: number };

/** Сколько раз повторное ревью после слияния может вернуть задачу на работу. */
const MAX_REWORKS = 2;
/** Порт vite для `pnpm visual` потока: два verify одновременно не делят один порт. */
const VISUAL_PORT_BASE = 5180;

export interface StreamRequest {
  readonly target: StageTarget;
  readonly slot: number;
  readonly task: string;
  readonly cancelled: () => string | undefined;
}

async function streamContext(request: StreamRequest): Promise<LoopContext> {
  const { target, slot, task } = request;
  const main = target.context;
  const dir = slotDir(main.config.root, slot);
  const git = await target.lock.run(() =>
    checkoutTask(main.git, main.config.runCommand, main.config.root, slot, task, target.branch),
  );
  const config = {
    ...main.config,
    root: dir,
    env: { ...main.config.env, VISUAL_PORT: String(VISUAL_PORT_BASE + slot) },
  };
  const name = `w${slot}`;
  return {
    config,
    definitions: main.definitions,
    git,
    state: await loadState(dir),
    say: async (line) => {
      // Один протокол на весь цикл: строки потоков — в протоколе главного каталога.
      await main.say(`[${name} ${task}] ${line}`);
    },
    stream: { name, task, branch: agentBranch(task), cancelled: request.cancelled },
  };
}

/** Шаг потока закончился ожиданием: сбой codex (пауза) или вопрос владельцу. */
const stopped = (context: LoopContext): StreamOutcome => {
  const until = context.state.retryAfter;
  if (until !== undefined && until > context.config.now()) return { kind: 'backoff', until };
  return { kind: 'parked', reason: context.state.parked?.reason ?? 'ждёт владельца' };
};

async function work(context: LoopContext, task: string): Promise<Step | 'done'> {
  const { stageText } = await readStage(context.config.root);
  const mark = taskMark(stageText, task) ?? ' ';
  if (mark === 'x') return 'done';
  const resume = (await dirtyFiles(context.git)) !== '' && context.state.resume === task;
  const run = await processTask(context, task, {
    mark,
    workPrompt: `$task ${task}`,
    spec: true,
    resume,
  });
  return run.done ? 'done' : run.step;
}

/**
 * Продолжение начатой задачи: новые коммиты ветки этапа (ответ владельца на вопрос, `$decide`)
 * вливаются в ветку задачи. Конфликт здесь не разрешается — его разберёт очередь слияния.
 */
async function refreshBase(context: LoopContext, target: StageTarget): Promise<void> {
  const { git } = context;
  const base = `origin/${target.branch}`;
  if ((await dirtyFiles(git)) !== '' || (await isAncestor(git, base, 'HEAD'))) return;
  const task = context.stream?.task ?? '';
  const merged = await git.attempt([
    'merge',
    '--no-ff',
    '-m',
    mergeMessage(task, target.branch),
    base,
  ]);
  if (merged.code !== 0) {
    await git.attempt(['merge', '--abort']);
    return;
  }
  await context.say(`влиты новые коммиты ${target.branch}`);
  // `$task` начинает с `pnpm ci:wait` на HEAD: незапушенный коммит слияния ждал бы CI вечно.
  const unsynced = await syncWithOrigin(git, true);
  if (unsynced !== undefined) await context.say(unsynced);
}

/** Поток свободен: ветка задачи удалена, память потока стёрта. */
async function release(
  request: StreamRequest,
  context: LoopContext,
  discard: boolean,
): Promise<void> {
  const main = request.target.context.git;
  await request.target.lock.run(() => releaseSlot(main, context.git, request.task, discard));
  await rm(statePath(context.config.root), { force: true });
}

/**
 * Задача в потоке до слияния в ветку этапа. Перезапуск (новый коммит владельца, конец паузы,
 * перезапуск цикла) продолжает с того же места: ветка задачи и память потока сохраняются.
 */
export async function runStream(request: StreamRequest): Promise<StreamOutcome> {
  const { target, task } = request;
  let context: LoopContext | undefined;
  try {
    context = await streamContext(request);
    await refreshBase(context, target);
    await context.say(`в работе, HEAD ${(await head(context.git)).slice(0, 7)}`);
    for (let rework = 0; rework <= MAX_REWORKS; rework += 1) {
      const done = await work(context, task);
      if (done !== 'done') return stopped(context);
      const { stageText } = await readStage(target.context.config.root);
      const result = await integrate(context, target, task, stageText);
      if (result === 'merged') {
        await context.say(`влита в ${target.branch}`);
        await release(request, context, false);
        return { kind: 'merged' };
      }
      if (result !== 'rework') return stopped(context);
      await context.say('повторное ревью вернуло задачу — новый круг работы');
    }
    return {
      kind: 'parked',
      reason: `${task}: повторное ревью после слияния снова вернуло задачу`,
    };
  } catch (error) {
    if (!(error instanceof StreamCancelled)) throw error;
    if (context !== undefined) {
      await context.say(`отменена: ${error.message}`);
      await release(request, context, true);
    }
    return { kind: 'cancelled', reason: error.message };
  }
}
