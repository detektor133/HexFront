// Диспетчер параллельных потоков (`--streams N`): главный каталог ведёт Issues, `slow` и закрытие
// этапа, потоки — задачи «Очереди» без пересечений по `Файлы:` и `После:`.
import { MAIN_AGENT } from './board.ts';
import {
  endPause,
  settleWait,
  selfClearing,
  firstLine,
  park,
  readStage,
  readStatus,
  save,
  type LoopContext,
  type Step,
} from './context.ts';
import { currentBranch, dirtyFiles, head, syncWithOrigin } from './git.ts';
import type { StageTarget } from './integrate.ts';
import { processIssues } from './issues.ts';
import { selectStreamTask } from './scope.ts';
import { slowGate } from './slow.ts';
import { brokenStatus, closedStage, closeStage } from './stage-close.ts';
import {
  closedStageBranch,
  isOwnerTask,
  selectTask,
  statusBranch,
  statusStage,
  taskBlock,
  taskMark,
} from './stage-file.ts';
import { loadState, MAX_STREAMS, saveState, type LoopState } from './state.ts';
import { runStream, type StreamOutcome } from './stream.ts';
import { branchTask, createLock, releaseSlot, slotDir, slotGit } from './worktree.ts';

/** Поток: задача, которую он держит, и почему он сейчас не работает. */
interface Slot {
  readonly index: number;
  task?: string;
  running?: Promise<void>;
  /** Ждёт владельца: перезапуск, когда HEAD ветки этапа станет другим. */
  waitHead?: string;
  /** Пауза после сбоя codex до этого времени, мс. */
  retryAfter?: number;
  /** Текст задачи изменился: поток отбрасывает работу при первой возможности. */
  cancel?: string;
}

const busyTasks = (slots: readonly Slot[]): string[] =>
  slots.flatMap((slot) => (slot.task === undefined ? [] : [slot.task]));

/** Issue поменяла блок задачи в работе (`$decide`) — поток начинает её заново по новому тексту. */
async function cancelChanged(
  context: LoopContext,
  slots: readonly Slot[],
  before: ReadonlyMap<string, string>,
): Promise<void> {
  const { stageText } = await readStage(context.config.root);
  for (const slot of slots) {
    if (slot.task === undefined || slot.cancel !== undefined) continue;
    if (taskBlock(stageText, slot.task) === before.get(slot.task)) continue;
    slot.cancel = `текст ${slot.task} изменён Issue — задача начнётся заново`;
    await context.say(`поток w${slot.index}: ${slot.cancel}`);
  }
}

/** Ни один поток не занят и брать нечего: задача владельца, ожидание зависимости или конец этапа. */
async function nothingToStart(context: LoopContext): Promise<Step> {
  const stage = await readStage(context.config.root);
  const task = selectTask(stage.status, stage.stageText);
  if (task === undefined) return closeStage(context, stage);
  const block = taskBlock(stage.stageText, task);
  if (isOwnerTask(block))
    return park(
      context,
      `owner:${task}`,
      `очередь дошла до ${task} — это задача владельца. Когда сделаешь — Issue «$done ${task}» с текстом, что сделано`,
      firstLine(block),
    );
  return park(
    context,
    `blocked:${task}`,
    `${task} ждёт задач из своего «После:», а потоки свободны — проверь «Очередь»`,
  );
}

/** Шаг главного каталога: Issues, закрытый этап, `slow`; при свободных потоках — конец очереди. */
async function mainStep(context: LoopContext, slots: readonly Slot[]): Promise<Step> {
  const { config, git, state } = context;
  if (state.retryAfter !== undefined) {
    if (state.retryAfter > config.now()) return 'idle';
    // Пауза кончилась: без удаления новые задачи потокам не выдавались бы никогда (fill).
    await endPause(context);
  }
  const status = await readStatus(config.root);
  const expected = statusBranch(status);
  const branch = await currentBranch(git);
  if (expected !== undefined && branch !== expected)
    return park(context, 'branch', `ожидалась ветка ${expected} из STATUS, сейчас ${branch}`);
  const dirty = await dirtyFiles(git);
  if (dirty !== '') return (await processIssues(context, true)) ?? 'idle';
  const unsynced = await syncWithOrigin(git, true);
  if (unsynced !== undefined) return park(context, 'sync', unsynced);
  // Ветка, дерево и синхронизация в порядке: их ожидание снято.
  await settleWait(context, (key) => !key.startsWith('slow:'));
  const busy = busyTasks(slots);
  const before = new Map<string, string>();
  if (busy.length > 0) {
    const { stageText } = await readStage(config.root);
    for (const task of busy) before.set(task, taskBlock(stageText, task));
  }
  const issue = await processIssues(context, false);
  if (issue !== undefined) {
    await cancelChanged(context, slots, before);
    return issue;
  }
  const broken = await brokenStatus(context);
  if (broken !== undefined) return broken;
  const stage = await readStage(config.root);
  const closed = closedStageBranch(stage.status);
  if (closed !== undefined) return busy.length === 0 ? closedStage(context, closed) : 'idle';
  const { parked } = state;
  if (parked && !selfClearing(parked.key) && parked.head === (await head(git))) return 'idle';
  const slow = await slowGate(context);
  if (slow !== undefined) return slow;
  if (busy.length > 0 || selectStreamTask(stage.status, stage.stageText, busy) !== undefined)
    return 'idle';
  return nothingToStart(context);
}

/** Итог потока: свободен (влито, отменено) или держит задачу до коммита владельца или паузы. */
async function settle(context: LoopContext, slot: Slot, outcome: StreamOutcome): Promise<void> {
  delete slot.waitHead;
  delete slot.retryAfter;
  if (outcome.kind === 'merged' || outcome.kind === 'cancelled') {
    delete slot.task;
    delete slot.cancel;
    return;
  }
  if (outcome.kind === 'backoff') slot.retryAfter = outcome.until;
  else {
    slot.waitHead = await head(context.git);
    await context.say(`поток w${slot.index} ждёт: ${outcome.reason}`);
  }
}

function start(target: StageTarget, slot: Slot): void {
  const { context } = target;
  const task = slot.task;
  if (task === undefined) return;
  slot.running = runStream({ target, slot: slot.index, task, cancelled: () => slot.cancel })
    .then((outcome) => settle(context, slot, outcome))
    .catch(async (error: unknown) => {
      await context.say(
        `поток w${slot.index} ${task}: ошибка — ${error instanceof Error ? error.message : String(error)}`,
      );
      slot.retryAfter = context.config.now() + 30 * 60_000;
    })
    .finally(() => {
      delete slot.running;
    });
}

/** Отменённая задача потока, который сейчас не работает: работа отбрасывается сразу. */
async function dropCancelled(target: StageTarget, slot: Slot): Promise<void> {
  const { context } = target;
  const git = await slotGit(context.config.runCommand, context.config.root, slot.index);
  const task = slot.task;
  if (git !== undefined && task !== undefined)
    await target.lock.run(() => releaseSlot(context.git, git, task, true));
  delete slot.task;
  delete slot.cancel;
  delete slot.waitHead;
  delete slot.retryAfter;
}

/** Запускает потоки: продолжает задачи после ожидания и берёт новые. @returns сколько запущено. */
async function fill(target: StageTarget, slots: readonly Slot[]): Promise<number> {
  const { context } = target;
  const now = context.config.now();
  const current = await head(context.git);
  let started = 0;
  for (const slot of slots) {
    if (slot.running !== undefined || slot.task === undefined) continue;
    if (slot.cancel !== undefined) await dropCancelled(target, slot);
    else if (
      (slot.retryAfter === undefined && slot.waitHead === undefined) ||
      (slot.retryAfter !== undefined && slot.retryAfter <= now) ||
      (slot.waitHead !== undefined && slot.waitHead !== current)
    ) {
      start(target, slot);
      started += 1;
    }
  }
  const status = await readStatus(context.config.root);
  // Предел 1 — прежний цикл в главном каталоге: потоки только доделывают начатое, потом 'switch'.
  if (
    streamLimit(context) === 1 ||
    statusStage(status) === undefined ||
    closedStageBranch(status) !== undefined ||
    context.state.retryAfter !== undefined
  )
    return started;
  const { stageText } = await readStage(context.config.root);
  for (const slot of slots) {
    // Предел уменьшен Issue `$streams`: начатое доделывается, новое — только когда задач меньше предела.
    if (busyTasks(slots).length >= streamLimit(context)) break;
    if (slot.task !== undefined || slot.index > streamLimit(context)) continue;
    const task = selectStreamTask(status, stageText, busyTasks(slots));
    if (task === undefined) break;
    slot.task = task;
    await context.say(`поток w${slot.index}: задача ${task} [${taskMark(stageText, task) ?? ' '}]`);
    start(target, slot);
    started += 1;
  }
  return started;
}

/**
 * Потоки, начатые до перезапуска цикла или смены режима: каталог на ветке `agent/NN-Tn` —
 * задача продолжается, даже если предел потоков с тех пор уменьшен.
 * @returns false, если STATUS не читается и восстановление нужно повторить позже.
 */
async function recover(target: StageTarget, slots: Slot[]): Promise<boolean> {
  const { context } = target;
  if (statusStage(await readStatus(context.config.root)) === undefined) return false;
  const { stageText } = await readStage(context.config.root);
  for (let index = 1; index <= MAX_STREAMS; index += 1) {
    const git = await slotGit(context.config.runCommand, context.config.root, index);
    if (git === undefined) continue;
    const task = branchTask(await currentBranch(git));
    if (task === undefined) continue;
    const mark = taskMark(stageText, task);
    if (mark === ' ' || mark === '~') {
      const slot = slotAt(slots, index);
      slot.task = task;
      await context.say(`поток w${index}: продолжаю ${task}`);
    } else await target.lock.run(() => releaseSlot(context.git, git, task, false));
  }
  return true;
}

/**
 * Ожидание: конец любого потока, изменение Issues или `main` (условный запрос), Enter
 * или раз в pollMinutes — полный шаг.
 */
async function waitStreams(context: LoopContext, running: readonly Promise<void>[]): Promise<void> {
  const { config } = context;
  const deadline = config.now() + config.pollMinutes * 60_000;
  let finished = false;
  const any = running.length === 0 ? new Promise<void>(() => undefined) : Promise.race(running);
  void any.then(() => {
    finished = true;
  });
  while (!finished && config.now() < deadline) {
    const woke = await Promise.race([
      any.then(() => 'stream' as const),
      config.sleep(config.pollSeconds * 1000),
    ]);
    if (woke !== 'timer') return;
    const changed = await config.github?.changed().catch(() => false);
    if (changed === true) return;
  }
}

/** Поток с номером index; недостающие потоки до него создаются. */
function slotAt(slots: Slot[], index: number): Slot {
  while (slots.length < index) slots.push({ index: slots.length + 1 });
  const slot = slots[index - 1];
  if (slot === undefined) throw new Error(`нет потока w${index}`);
  return slot;
}

/** Предел одновременных задач из памяти цикла (Issue `$streams N`, `--streams N`). */
export const streamLimit = (context: LoopContext): number => context.state.streams ?? 1;

/** Число агентов, заданное владельцем в консоли цикла: то же, что Issue `$streams N`. */
export async function applyLimitRequest(context: LoopContext): Promise<void> {
  const requested = context.config.board?.takeLimit();
  if (requested === undefined || requested === streamLimit(context)) return;
  context.state.streams = requested;
  await save(context);
  await context.say(`консоль: агентов до ${requested}`);
}

/**
 * Владелец клавишей консоли просит повторить шаг, на котором агент ждёт, — как перезапуск цикла,
 * но только для этого агента: ожидание в памяти забывается, шаг идёт заново.
 */
export async function applyRetries(
  context: LoopContext,
  slots: readonly Slot[] = [],
): Promise<void> {
  const board = context.config.board;
  for (const agent of board?.takeRetries() ?? []) {
    if (agent === MAIN_AGENT) {
      forgetWait(context.state);
      await save(context);
      board?.end(agent, 'повторяю по просьбе владельца');
      await context.say('консоль: владелец просит повторить шаг');
      continue;
    }
    const slot = slots.find((candidate) => `w${candidate.index}` === agent);
    if (slot?.task === undefined || slot.running !== undefined || slot.waitHead === undefined) {
      await context.say(`консоль: ${agent} уже не ждёт — повторять нечего`);
      continue;
    }
    delete slot.waitHead;
    // Память потока лежит в его каталоге: без её ожидания тот же park снова промолчал бы.
    const dir = slotDir(context.config.root, slot.index);
    const state = await loadState(dir);
    forgetWait(state);
    await saveState(dir, state);
    board?.end(agent, 'повторяю по просьбе владельца');
    await context.say(`консоль: владелец просит повторить шаг потока ${agent} (${slot.task})`);
  }
}

/**
 * Забыть ожидание, как перезапуск цикла. Неудачная доделка (`resume:NN/Tn`) уже стёрла `resume`:
 * повтор возвращает его, иначе грязное дерево ушло бы в другое ожидание вместо доделки.
 */
function forgetWait(state: LoopState): void {
  const task = /^resume:(.+)$/u.exec(state.parked?.key ?? '')?.[1];
  if (task !== undefined) state.resume = task;
  delete state.parked;
}

/**
 * Цикл с потоками; предел читается на каждом шаге. `--once` — выход, когда потоки свободны и
 * работы без владельца нет.
 * @returns код выхода или 'switch' — предел стал 1 и потоки свободны: дальше цикл по одной задаче.
 */
export async function runStreams(context: LoopContext): Promise<number | 'switch'> {
  const { config } = context;
  const lock = createLock();
  const stageBranch = async (): Promise<string> =>
    statusBranch(await readStatus(config.root)) ?? (await currentBranch(context.git));
  const slots: Slot[] = [];
  // Слияние другого потока — не ответ владельца: ждущие потоки продолжают ждать.
  const onMerged = (sha: string): void => {
    for (const slot of slots) if (slot.waitHead !== undefined) slot.waitHead = sha;
  };
  let target: StageTarget = { context, branch: await stageBranch(), lock, onMerged };
  let recovered = false;
  await context.say(`потоков до ${streamLimit(context)}, ветка этапа ${target.branch}`);
  for (;;) {
    await applyLimitRequest(context);
    await applyRetries(context, slots);
    slotAt(slots, streamLimit(context));
    // После `$stage-close` ветка этапа новая: потоки, начатые дальше, ветвятся от неё.
    if (busyTasks(slots).length === 0)
      target = { context, branch: await stageBranch(), lock, onMerged };
    let step: Step;
    let started = 0;
    try {
      if (!recovered) recovered = await recover(target, slots);
      step = await target.lock.run(() => mainStep(context, slots));
      started = await fill(target, slots);
    } catch (error) {
      await context.say(`ошибка: ${error instanceof Error ? error.message : String(error)}`);
      if (config.once) return 1;
      step = 'idle';
    }
    await save(context);
    // До восстановления потоков (STATUS не читается) их работа неизвестна: режим не меняется.
    if (recovered && streamLimit(context) === 1 && busyTasks(slots).length === 0) return 'switch';
    if (step === 'worked' || started > 0) continue;
    const running = slots.flatMap((slot) => (slot.running === undefined ? [] : [slot.running]));
    if (config.once && running.length === 0) {
      await context.say('итог: работы без владельца нет');
      return 0;
    }
    await waitStreams(context, running);
  }
}
