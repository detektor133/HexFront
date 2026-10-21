// Круги задачи: работа ($next или $task) → CI → $review; $split, $accept и доделка — без владельца.
import {
  agentName,
  backoff,
  firstLine,
  park,
  readStage,
  runSkill,
  save,
  session,
  waitCi,
  type LoopContext,
  type SkillResult,
  type Step,
} from './context.ts';
import { dirtyFiles, head, syncWithOrigin } from './git.ts';
import { runPlan } from './plan.ts';
import { lastReturnItems, withReviewFeedback } from './return-guard.ts';
import { runReview } from './review.ts';
import { forbiddenPaths, isInfraTask, scopeViolation } from './scope-guard.ts';
import { waitForAnswer, withAnswer } from './shelve.ts';
import { commandTask, reviewTasks, taskBlock } from './stage-file.ts';

/** Итог сессии работы: задача на ревью, повторить работу или шаг цикла. */
type Work =
  | { readonly kind: 'review'; readonly task: string; readonly message?: string }
  | { readonly kind: 'again'; readonly prompt?: string }
  | { readonly kind: 'step'; readonly step: Step };
export interface TaskRun {
  readonly step: Step;
  /** Задача прошла ревью и стала `[x]`. */
  readonly done: boolean;
}

/** Сколько раз за круги одной задачи цикл сам повторяет работу после `$accept` или красного CI. */
const MAX_FOLLOW_UPS = 2;

/** Сколько всего возвратов было за все запуски цикла, если больше кругов одного запуска. */
const totalNote = (context: LoopContext, task: string): string => {
  const total = context.state.returnTotals[task] ?? 0;
  return total > context.config.maxRounds ? ` (всего возвратов за задачу: ${total})` : '';
};

export const resumePrompt = (task: string): string => `$task ${task} продолжить`;
/** Работа над задачей после красного CI: сессия начинает с причины, а не с поиска задачи в очереди. */
export const ciFixPrompt = (task: string, line: string): string =>
  `$task ${task} CI красный: ${line}`;
const step = (value: Step): Work => ({ kind: 'step', step: value });

/**
 * Миграция незакрытого возврата прежней версии цикла: восстанавливает активный handoff из блока
 * задачи. Новые возвраты сохраняются дословно сразу после reviewer.
 */
async function restoreReviewFeedback(context: LoopContext, task: string): Promise<void> {
  const { state } = context;
  if (state.reviewFeedback[task] !== undefined || state.reviewReturns[task] === undefined) return;
  const { stageText } = await readStage(context.config.root);
  const items = lastReturnItems(taskBlock(stageText, task));
  if (items.length === 0) return;
  state.reviewFeedback = {
    ...state.reviewFeedback,
    [task]: ['ВОЗВРАТ', ...items.map((item) => `- ${item}`)].join('\n'),
  };
  await save(context);
}

/** Скилл не выполнился: технический сбой повторяется после паузы без участия владельца. */
export const skillFailed = (
  context: LoopContext,
  prompt: string,
  result: SkillResult & { ok: false },
) => backoff(context, `${prompt}: ${result.reason}`, result.message);

/** `$split` или `$accept`, о которых просит ответ работы; иначе задача ждёт владельца. */
async function followUp(
  context: LoopContext,
  task: string,
  message: string,
  accepted: Set<string>,
): Promise<Work> {
  const split = commandTask(message, '$split');
  // В потоке разбиение меняло бы «Очередь» в ветке задачи: только Issue владельца на ветке этапа.
  if (split !== undefined && context.stream !== undefined)
    return step(
      await park(
        context,
        `split:${split}`,
        `${split} просят разбить — нужна Issue «$split ${split}»`,
        message,
      ),
    );
  if (split !== undefined) {
    if (context.state.split.includes(split))
      return step(
        await park(
          context,
          `split:${split}`,
          `${split} снова просят разбить — нужен владелец`,
          message,
        ),
      );
    context.state.split.push(split);
    await save(context);
    const result = await runSkill(context, 'next', `$split ${split}`);
    return step(result.ok ? 'worked' : await skillFailed(context, `$split ${split}`, result));
  }
  const accept = commandTask(message, '$accept');
  if (accept !== undefined && !accepted.has(accept)) {
    accepted.add(accept);
    const result = await runSkill(context, 'next', `$accept ${accept}`);
    return result.ok
      ? { kind: 'again' }
      : step(await skillFailed(context, `$accept ${accept}`, result));
  }
  return step(
    await park(
      context,
      `task:${task}`,
      `${task} не отмечена [~]: нужен владелец — ответ на вопрос Issue «$decide», своя проверка или задача — «$done ${task}»`,
      message,
    ),
  );
}

/** Сессия работы над задачей; незакоммиченная работа доделывается одной сессией `продолжить`. */
async function runWork(
  context: LoopContext,
  task: string,
  prompt: string,
  accepted: Set<string>,
): Promise<Work> {
  const { git, state } = context;
  const base = await head(git);
  // Приёмочные тесты написаны для этой задачи: `$next` выбрал бы задачу сам, и 2026-10-14
  // исполнитель с тестами 07/T1 взял 07/T2. Задача с тестами идёт по номеру.
  const pinned =
    prompt === '$next' && state.reviewFeedback[task] !== undefined ? `$task ${task}` : prompt;
  // Оборванная сессия (Ctrl+C, сбой ПК) оставляет работу в дереве: перезапуск её доделает.
  // Только когда задача известна заранее: `$next` без тестов выбирает её сам.
  if (pinned !== '$next') {
    state.resume = task;
    await save(context);
  }
  const full = withReviewFeedback(
    await withAnswer(context, pinned, resumePrompt(task)),
    task,
    state.reviewFeedback[task],
  );
  const work = await session(context, 'next', full);
  const dirty = (await dirtyFiles(git)) !== '';
  if (work.failure !== undefined) {
    if (dirty) state.resume = task;
    else delete state.resume;
    return step(
      await backoff(
        context,
        `${firstLine(prompt)}: ${work.failure}`,
        work.message + work.result.stderr,
      ),
    );
  }
  if (dirty) {
    if (prompt.startsWith(resumePrompt(task))) {
      delete state.resume;
      return step(await waitForAnswer(context, task, work.message));
    }
    state.resume = task;
    await save(context);
    await context.say(`недоделка ${task}: дерево не чистое — продолжаю отдельной сессией`);
    return runWork(context, task, resumePrompt(task), accepted);
  }
  delete state.resume;
  await save(context);
  if (!isInfraTask(task)) {
    const forbidden = await forbiddenPaths(git, base);
    if (forbidden.length > 0)
      return step(await park(context, `scope:${task}`, scopeViolation(task, forbidden)));
  }
  const unsynced = await syncWithOrigin(git, true);
  if (unsynced !== undefined) return step(await park(context, `sync:${task}`, unsynced));
  const { stage, stageText } = await readStage(context.config.root);
  const waiting = reviewTasks(stageText, stage);
  const streamLimit = context.state.streams ?? 1;
  if (waiting.length > 1 && streamLimit > 1)
    return step(await park(context, `many:${task}`, `ждут ревью сразу ${waiting.join(', ')}`));
  const [review] = waiting;
  if (review === undefined) return followUp(context, task, work.message, accepted);
  if (review !== task) {
    context.config.board?.task(agentName(context), review);
    await context.say(`${firstLine(prompt)} взял ${review} вместо ${task}`);
  }
  return { kind: 'review', task: review, message: work.message };
}

/**
 * CI перед ревью: HEAD, чей зелёный CI цикл уже видел, не ждёт. Красный — работа с причиной,
 * не проверенный (сеть, таймаут) — пауза, а не ревью кода, который CI ещё не прошёл.
 */
async function ciBeforeReview(context: LoopContext, task: string): Promise<Work | undefined> {
  if (context.state.greenHead === (await head(context.git))) return undefined;
  const ci = await waitCi(context, `перед $review ${task}`, true);
  if (ci.verdict === 'green') return undefined;
  if (ci.verdict === 'red') return { kind: 'again', prompt: ciFixPrompt(task, ci.line) };
  return step(await backoff(context, `CI ${task} не проверен: ${ci.line}`, ''));
}

/** Автор тестов работает после принятия кода и не получает возвраты исполнителя. */
async function runTestAuthor(context: LoopContext, task: string): Promise<Work> {
  const feedback = context.state.testFeedback[task];
  const prompt = [
    `$tests ${task}`,
    'Код уже принят reviewer. Пиши и коммить только тесты реальных путей и краёв.',
    'Возврат тестов исправляешь ты; код продукта не меняй.',
    ...(feedback === undefined ? [] : ['ВОЗВРАТ REVIEWER ТЕСТОВ:', feedback]),
  ].join('\n');
  const result = await session(context, 'test', prompt);
  if (result.failure !== undefined)
    return step(await backoff(context, `$tests ${task}: ${result.failure}`, result.message));
  if ((await dirtyFiles(context.git)) !== '')
    return step(
      await backoff(context, `$tests ${task} оставил незакоммиченные файлы`, result.message),
    );
  const unsynced = await syncWithOrigin(context.git, true);
  if (unsynced !== undefined) return step(await park(context, `sync:${task}`, unsynced));
  context.state.testPhase = { ...context.state.testPhase, [task]: 'review' };
  context.state.testFeedback = Object.fromEntries(
    Object.entries(context.state.testFeedback).filter(([key]) => key !== task),
  );
  await save(context);
  return { kind: 'review', task, message: result.message };
}

/**
 * Круги одной задачи, не больше maxRounds ВОЗВРАТ. `workPrompt` — `$next` для очереди
 * или `$task NN/Tn` для Issue; `resume` — начать с доделки незакоммиченной работы.
 */
export async function processTask(
  context: LoopContext,
  task: string,
  options: {
    readonly mark: string;
    readonly workPrompt: string;
    readonly resume?: boolean;
  },
): Promise<TaskRun> {
  const { config, say } = context;
  const accepted = new Set<string>();
  let current = task;
  await restoreReviewFeedback(context, current);
  config.board?.task(agentName(context), task);
  // Доделка всегда начинается с работы: `[~]` в незакоммиченном файле этапа ещё не проверен.
  let needsWork = options.resume === true || options.mark !== '~';
  let prompt = options.resume === true ? resumePrompt(task) : options.workPrompt;
  let followUps = 0;
  for (let round = 1; round <= config.maxRounds;) {
    const testingEnabled = context.definitions.roles.test !== undefined;
    const phase = testingEnabled ? context.state.testPhase[current] : undefined;
    const work =
      phase === 'write'
        ? await runTestAuthor(context, current)
        : needsWork
          ? await runWork(context, current, prompt, accepted)
          : { kind: 'review' as const, task: current };
    if (work.kind === 'review') current = work.task;
    prompt = options.workPrompt;
    const checked =
      !testingEnabled && work.kind === 'review' ? await ciBeforeReview(context, work.task) : work;
    if (checked?.kind === 'step') return { step: checked.step, done: false };
    if (checked?.kind === 'again') {
      followUps += 1;
      if (followUps > MAX_FOLLOW_UPS)
        return {
          step: await backoff(
            context,
            `CI или приёмка ${current} снова не прошли — повторю автоматически`,
            '',
          ),
          done: false,
        };
      if (checked.prompt !== undefined) prompt = checked.prompt;
      needsWork = true;
      continue;
    }
    const reviewingTests = testingEnabled && context.state.testPhase[current] === 'review';
    const verdict = await runReview(
      context,
      current,
      testingEnabled
        ? reviewingTests
          ? 'Режим reviewer тестов: проверь покрытие, реальные пути и края. Возврат теста начинай «ТЕСТ:», дефект продукта — «КОД:». Код и тесты не изменяй.'
          : 'Режим reviewer кода: проверь реальный путь и критерии продукта. Тесты пока не проверяй.'
        : '',
    );
    if (typeof verdict === 'string') return { step: verdict, done: false };
    if (verdict.mark === 'x') {
      if (!reviewingTests && testingEnabled) {
        context.state.testPhase = { ...context.state.testPhase, [current]: 'write' };
        await save(context);
        await say(`код ${current} принят — передаю отдельному автору тестов`);
        needsWork = false;
        continue;
      }
      const ci = testingEnabled ? await ciBeforeReview(context, current) : undefined;
      if (ci?.kind === 'step') return { step: ci.step, done: false };
      if (ci?.kind === 'again') {
        context.state.testPhase = Object.fromEntries(
          Object.entries(context.state.testPhase).filter(([key]) => key !== current),
        );
        await save(context);
        prompt = ci.prompt ?? ciFixPrompt(current, 'CI красный');
        needsWork = true;
        continue;
      }
      context.state.reviewFeedback = Object.fromEntries(
        Object.entries(context.state.reviewFeedback).filter(([key]) => key !== current),
      );
      context.state.testPhase = Object.fromEntries(
        Object.entries(context.state.testPhase).filter(([key]) => key !== current),
      );
      context.state.testFeedback = Object.fromEntries(
        Object.entries(context.state.testFeedback).filter(([key]) => key !== current),
      );
      context.state.returnTotals = Object.fromEntries(
        Object.entries(context.state.returnTotals).filter(([key]) => key !== current),
      );
      context.state.planBlocked = Object.fromEntries(
        Object.entries(context.state.planBlocked).filter(([key]) => key !== current),
      );
      await save(context);
      config.board?.count('done');
      await say(`готово: ${current}`);
      return { step: 'worked', done: true };
    }
    if (reviewingTests) {
      const items = lastReturnItems(
        taskBlock((await readStage(context.config.root)).stageText, current),
      );
      const codeItems = items.filter((item) => item.startsWith('КОД:'));
      if (codeItems.length === 0) {
        context.state.testFeedback = { ...context.state.testFeedback, [current]: verdict.message };
        context.state.testPhase = { ...context.state.testPhase, [current]: 'write' };
        await save(context);
        await say(`ВОЗВРАТ тестов ${current} — возвращаю автору тестов`);
        needsWork = false;
        continue;
      }
      context.state.reviewFeedback = {
        ...context.state.reviewFeedback,
        [current]: ['ВОЗВРАТ', ...codeItems.map((item) => `- ${item}`)].join('\n'),
      };
      context.state.testPhase = Object.fromEntries(
        Object.entries(context.state.testPhase).filter(([key]) => key !== current),
      );
      await say(`дефект кода ${current} найден тестами — возвращаю исполнителю`);
    } else {
      context.state.reviewFeedback = {
        ...context.state.reviewFeedback,
        [current]: verdict.message,
      };
    }
    config.board?.count('returns');
    context.state.returnTotals = {
      ...context.state.returnTotals,
      [current]: (context.state.returnTotals[current] ?? 0) + 1,
    };
    await save(context);
    await say(`ВОЗВРАТ ${current}, круг ${round} из ${config.maxRounds}`);
    if (round === config.maxRounds) {
      await say(
        `${config.maxRounds} ВОЗВРАТ подряд по ${current}${totalNote(context, current)} — начинаю новый автоматический цикл`,
      );
      if (context.definitions.roles.plan === undefined) return { step: 'worked', done: false };
      const planned = await runPlan(context, current);
      if (typeof planned === 'string') return { step: planned, done: false };
      await say(`$plan ${current}: повторные возвраты разобраны, продолжаю очередь автоматически`);
      return { step: 'worked', done: false };
    }
    needsWork = true;
    round += 1;
  }
  await say(
    `${config.maxRounds} ВОЗВРАТ подряд по ${current}${totalNote(context, current)} — начинаю новый автоматический цикл`,
  );
  return { step: 'worked', done: false };
}
