// Круги задачи: работа ($next или $task) → CI → $review; $split, $accept и доделка — без владельца.
import {
  backoff,
  checkPermissions,
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
import {
  forgetSpec,
  placeSpec,
  setSpecAside,
  specEnabled,
  specFiles,
  specViolation,
  withSpec,
  writeSpec,
} from './spec.ts';
import { commandTask, reviewTasks, taskMark } from './stage-file.ts';

/** Итог сессии работы: задача на ревью, повторить работу или шаг цикла. */
type Work =
  | { readonly kind: 'review'; readonly task: string }
  | { readonly kind: 'again'; readonly prompt?: string }
  | { readonly kind: 'step'; readonly step: Step };
export interface TaskRun {
  readonly step: Step;
  /** Задача прошла ревью и стала `[x]`. */
  readonly done: boolean;
}

/** Сколько раз за круги одной задачи цикл сам повторяет работу после `$accept` или красного CI. */
const MAX_FOLLOW_UPS = 2;

/** Замечание к приёмочным тестам: строка `СПЕК: …` в ответе `ВОЗВРАТ` ревью или исполнителя. */
const SPEC_REMARK_RE = /^\s*[-*]?\s*СПЕК:/imu;

export const resumePrompt = (task: string): string => `$task ${task} продолжить`;
/** Работа над задачей после красного CI: сессия начинает с причины, а не с поиска задачи в очереди. */
export const ciFixPrompt = (task: string, line: string): string =>
  `$task ${task} CI красный: ${line}`;
const step = (value: Step): Work => ({ kind: 'step', step: value });

/** Скилл не выполнился: сбой codex — пауза, иначе ожидание владельца с ответом скилла. */
export const skillFailed = (
  context: LoopContext,
  prompt: string,
  result: SkillResult & { ok: false },
) =>
  result.codexFailed
    ? backoff(context, `${prompt}: ${result.reason}`, result.message)
    : park(context, `skill:${prompt}`, `${prompt} — ${result.reason}`, result.message);

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
      `${task} не отмечена [~]: нужен владелец (вопрос, проверка или задача владельца)`,
      message,
    ),
  );
}

/** Строки `СПЕК: …` ответа: замечания к приёмочным тестам. */
const specRemarks = (message: string): string =>
  message
    .split(/\r?\n/)
    .filter((line) => SPEC_REMARK_RE.test(line))
    .join('\n');

/**
 * Исполнитель остановился на сломанном приёмочном тесте: `$spec` чинит тест по его замечанию,
 * работа исполнителя остаётся в дереве и продолжается. Второе такое замечание — к владельцу.
 */
async function repairSpec(
  context: LoopContext,
  task: string,
  remarks: string,
  accepted: Set<string>,
): Promise<Work> {
  const { state } = context;
  if (state.specRepairs.includes(task))
    return step(
      await park(
        context,
        `spec:${task}`,
        `приёмочные тесты ${task} снова мешают исполнителю — нужен владелец`,
        remarks,
      ),
    );
  state.specRepairs.push(task);
  await save(context);
  await context.say(`исполнитель: приёмочные тесты ${task} сломаны — их чинит $spec`);
  await placeSpec(context, task);
  const stop = await writeSpec(context, task, `Исполнитель задачи:\n${remarks}`);
  if (stop !== undefined) return step(stop);
  state.resume = task;
  await save(context);
  return runWork(context, task, resumePrompt(task), accepted);
}

/** Сессия работы над задачей; незакоммиченная работа доделывается одной сессией `продолжить`. */
async function runWork(
  context: LoopContext,
  task: string,
  prompt: string,
  accepted: Set<string>,
): Promise<Work> {
  const { git, state } = context;
  const locked = specFiles(context, task);
  const base = await head(git);
  const work = await session(context, 'next', withSpec(prompt, task, locked), locked);
  const broken = specRemarks(work.message);
  // Исполнитель не может менять приёмочные тесты: их поломку (lint, окружение) чинит $spec.
  if (
    work.failure === undefined &&
    broken !== '' &&
    locked.length > 0 &&
    (await head(git)) === base
  )
    return repairSpec(context, task, broken, accepted);
  // Остановка с вопросом оставляет в дереве только приёмочные тесты: они вернутся к работе.
  const dirty = (await dirtyFiles(git)) !== '' && !(await setSpecAside(context, task));
  if (work.failure !== undefined) {
    if (dirty) state.resume = task;
    return step(
      await backoff(
        context,
        `${firstLine(prompt)}: ${work.failure}`,
        work.message + work.result.stderr,
      ),
    );
  }
  if (dirty) {
    if (prompt === resumePrompt(task)) {
      delete state.resume;
      return step(
        await park(
          context,
          `resume:${task}`,
          `доделка ${task} не закончена, дерево не чистое`,
          work.message,
        ),
      );
    }
    state.resume = task;
    await save(context);
    await context.say(`недоделка ${task}: дерево не чистое — продолжаю отдельной сессией`);
    return runWork(context, task, resumePrompt(task), accepted);
  }
  delete state.resume;
  await save(context);
  const unsynced = await syncWithOrigin(git, true);
  if (unsynced !== undefined) return step(await park(context, `sync:${task}`, unsynced));
  const { stage, stageText } = await readStage(context.config.root);
  const waiting = reviewTasks(stageText, stage);
  if (waiting.length > 1)
    return step(await park(context, `many:${task}`, `ждут ревью сразу ${waiting.join(', ')}`));
  const [review] = waiting;
  if (review === undefined) return followUp(context, task, work.message, accepted);
  if (review !== task) await context.say(`${firstLine(prompt)} взял ${review} вместо ${task}`);
  const violation = await specViolation(context, review);
  if (violation !== undefined) return step(await park(context, `spec:${review}`, violation));
  return { kind: 'review', task: review };
}

/** Вердикт `$review`: новая отметка задачи и ответ ревью (замечания к приёмочным тестам). */
export interface Verdict {
  readonly mark: 'x' | ' ';
  readonly message: string;
}

/**
 * `$review` в новой сессии; возвращает вердикт или шаг цикла.
 * @param note строка запроса сверх команды (повторное ревью после слияния ветки этапа).
 */
export async function runReview(
  context: LoopContext,
  task: string,
  note = '',
): Promise<Verdict | Step> {
  const { git } = context;
  const base = await head(git);
  const files = specFiles(context, task);
  const lines = [
    `$review ${task}`,
    ...(note === '' ? [] : [note]),
    ...(files.length === 0
      ? []
      : [`Приёмочные тесты задачи, написанные $spec до кода: ${files.join(', ')}`]),
  ];
  const prompt = lines.join('\n');
  const review = await session(context, 'review', prompt);
  if (review.failure !== undefined)
    return backoff(context, `$review ${task}: ${review.failure}`, review.message);
  // Ревью уже запушило коммит, поэтому откат здесь только развёл бы локальную и удалённую ветку.
  if (!(await checkPermissions(context, base, context.definitions.reviewerPaths)))
    return park(
      context,
      `review:${task}`,
      'ревью изменило файлы вне permissions.json — проверь коммит',
      review.message,
    );
  if ((await dirtyFiles(git)) !== '')
    return park(context, `review:${task}`, 'после $review дерево не чистое', review.message);
  const unsynced = await syncWithOrigin(git, true);
  if (unsynced !== undefined) return park(context, `sync:${task}`, unsynced);
  const mark = taskMark((await readStage(context.config.root)).stageText, task);
  // Модель может оформить вердикт как `OK` или **OK**: значение имеют слово и отметка в файле.
  const verdict = firstLine(review.message).replace(/[`*_]/g, '').trim();
  if (mark === 'x' && /^OK(?![\p{L}\d])/u.test(verdict))
    return { mark: 'x', message: review.message };
  if (mark === ' ' && verdict.startsWith('ВОЗВРАТ')) return { mark: ' ', message: review.message };
  return park(
    context,
    `review:${task}`,
    `ответ $review «${verdict}» не совпадает с отметкой [${mark ?? '?'}]`,
    review.message,
  );
}

/**
 * CI перед ревью: HEAD, чей зелёный CI цикл уже видел, не ждёт. Красный — работа с причиной,
 * не проверенный (сеть, таймаут) — пауза, а не ревью кода, который CI ещё не прошёл.
 */
async function ciBeforeReview(context: LoopContext, task: string): Promise<Work | undefined> {
  if (context.state.greenHead === (await head(context.git))) return undefined;
  const ci = await waitCi(context, `перед $review ${task}`);
  if (ci.verdict === 'green') return undefined;
  if (ci.verdict === 'red') return { kind: 'again', prompt: ciFixPrompt(task, ci.line) };
  return step(await backoff(context, `CI ${task} не проверен: ${ci.line}`, ''));
}

/**
 * Перед работой над задачей очереди: приёмочные тесты `$spec` написаны (один раз на задачу
 * или заново после замечаний ревью) и лежат в дереве. Доделка новых тестов не пишет.
 * @returns шаг цикла при остановке или undefined.
 */
async function prepareSpec(
  context: LoopContext,
  task: string,
  fresh: boolean,
  remarks: string,
): Promise<Step | undefined> {
  if (!specEnabled(context)) return undefined;
  if (fresh && !(task in context.state.spec)) {
    const stop = await writeSpec(context, task, remarks);
    if (stop !== undefined) return stop;
  }
  await placeSpec(context, task);
  return undefined;
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
    /** Писать приёмочные тесты `$spec` до работы; по умолчанию — только для `$next` очереди. */
    readonly spec?: boolean;
  },
): Promise<TaskRun> {
  const { config, say } = context;
  const accepted = new Set<string>();
  let current = task;
  // Доделка всегда начинается с работы: `[~]` в незакоммиченном файле этапа ещё не проверен.
  let needsWork = options.resume === true || options.mark !== '~';
  let prompt = options.resume === true ? resumePrompt(task) : options.workPrompt;
  let followUps = 0;
  let remarks = '';
  for (let round = 1; round <= config.maxRounds;) {
    if (needsWork && (options.spec ?? options.workPrompt === '$next')) {
      const stop = await prepareSpec(context, current, prompt === options.workPrompt, remarks);
      if (stop !== undefined) return { step: stop, done: false };
    }
    const work = needsWork
      ? await runWork(context, current, prompt, accepted)
      : { kind: 'review' as const, task: current };
    const checked = work.kind === 'review' ? await ciBeforeReview(context, work.task) : work;
    if (work.kind === 'review') current = work.task;
    prompt = options.workPrompt;
    if (checked?.kind === 'step') return { step: checked.step, done: false };
    if (checked?.kind === 'again') {
      followUps += 1;
      if (followUps > MAX_FOLLOW_UPS)
        return {
          step: await park(
            context,
            `again:${current}`,
            `CI или приёмка ${current} снова не прошли`,
          ),
          done: false,
        };
      if (checked.prompt !== undefined) prompt = checked.prompt;
      needsWork = true;
      continue;
    }
    const verdict = await runReview(context, current);
    if (typeof verdict === 'string') return { step: verdict, done: false };
    if (verdict.mark === 'x') {
      await forgetSpec(context, current);
      await say(`готово: ${current}`);
      return { step: 'worked', done: true };
    }
    // Ревью нашло, что приёмочные тесты не совпадают с задачей: они пишутся заново.
    remarks = SPEC_REMARK_RE.test(verdict.message) ? verdict.message : '';
    if (remarks !== '') await forgetSpec(context, current);
    await say(`ВОЗВРАТ ${current}, круг ${round} из ${config.maxRounds}`);
    needsWork = true;
    round += 1;
  }
  return {
    step: await park(
      context,
      `rounds:${current}`,
      `${config.maxRounds} ВОЗВРАТ подряд по ${current} — нужно решение владельца`,
    ),
    done: false,
  };
}
