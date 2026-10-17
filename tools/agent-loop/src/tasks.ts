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
import { skippedPrompt, skippedReturnItems } from './return-guard.ts';
import { runReview } from './review.ts';
import { waitForAnswer, withAnswer } from './shelve.ts';
import {
  adoptOwnerSpec,
  forgetSpec,
  mentionsSpec,
  pendingSpecReturn,
  placeSpec,
  prepareSpec,
  returnedForSpec,
  SPEC_REMARK_RE,
  specRemarks,
  setSpecAside,
  specEnabled,
  specFiles,
  specViolation,
  unlockedFiles,
  unlockSpec,
  withSpec,
  withUnlocked,
  writeSpec,
} from './spec.ts';
import { commandTask, reviewTasks, taskBlock } from './stage-file.ts';

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

/** Сколько раз за задачу `$spec` чинит тесты по разным замечаниям исполнителя. */
const MAX_SPEC_REPAIRS = 3;

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
      `${task} не отмечена [~]: нужен владелец — ответ на вопрос Issue «$decide», своя проверка или задача — «$done ${task}»`,
      message,
    ),
  );
}

/**
 * Исполнитель остановился на сломанном приёмочном тесте: `$spec` чинит тест по его замечанию,
 * работа исполнителя остаётся в дереве и продолжается. Разные замечания (окружение, потом
 * нехватка проверки) чинятся по очереди; то же замечание снова — `$spec` его не исправил.
 */
async function repairSpec(
  context: LoopContext,
  task: string,
  remarks: string,
  accepted: Set<string>,
): Promise<Work> {
  const { state } = context;
  const notes = state.specRepairNotes[task] ?? [];
  const note = remarks.trim();
  const reason = notes.includes(note)
    ? `$spec не исправил приёмочные тесты ${task} по тому же замечанию — нужен владелец`
    : notes.length >= MAX_SPEC_REPAIRS
      ? `приёмочные тесты ${task} чинились ${notes.length} раза и снова мешают — нужен владелец`
      : undefined;
  if (reason !== undefined) return step(await park(context, `spec:${task}`, reason, remarks));
  state.specRepairNotes = { ...state.specRepairNotes, [task]: [...notes, note] };
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
  // До сессии: тест, исправленный владельцем, — не нарушение исполнителя (`$task` из Issue
  // идёт без `placeSpec`).
  await adoptOwnerSpec(context, task);
  const locked = specFiles(context, task);
  const unlocked = unlockedFiles(context, task);
  const base = await head(git);
  // Приёмочные тесты написаны для этой задачи: `$next` выбрал бы задачу сам, и 2026-10-14
  // исполнитель с тестами 07/T1 взял 07/T2. Задача с тестами идёт по номеру.
  const pinned =
    prompt === '$next' && (locked.length > 0 || unlocked !== undefined) ? `$task ${task}` : prompt;
  // Оборванная сессия (Ctrl+C, сбой ПК) оставляет работу в дереве: перезапуск её доделает.
  // Только когда задача известна заранее: `$next` без тестов выбирает её сам.
  if (pinned !== '$next') {
    state.resume = task;
    await save(context);
  }
  const full = withUnlocked(
    withSpec(await withAnswer(context, pinned, resumePrompt(task)), task, locked),
    task,
    unlocked,
  );
  const work = await session(context, 'next', full, locked);
  // Исполнитель не может менять закрытые приёмочные тесты. Их поломку (lint, окружение) по строке
  // `СПЕК:` исполнителя чинит $spec; возврат ревью о тесте в блоке задачи их открывает
  // исполнителю. Строка возврата остаётся в блоке до коммита задачи.
  if (work.failure === undefined && locked.length > 0 && (await head(git)) === base) {
    const own = specRemarks(work.message);
    if (own !== '') return repairSpec(context, task, own, accepted);
    const { stageText } = await readStage(context.config.root);
    const returned = returnedForSpec(taskBlock(stageText, task), locked).trim();
    if (returned !== '' && !(state.specRepairNotes[task] ?? []).includes(returned)) {
      await unlockSpec(context, task);
      state.resume = task;
      await save(context);
      return runWork(context, task, resumePrompt(task), accepted);
    }
  }
  // Остановка с вопросом оставляет в дереве только приёмочные тесты: они вернутся к работе.
  const dirty = (await dirtyFiles(git)) !== '' && !(await setSpecAside(context, task));
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
  const unsynced = await syncWithOrigin(git, true);
  if (unsynced !== undefined) return step(await park(context, `sync:${task}`, unsynced));
  const { stage, stageText } = await readStage(context.config.root);
  const waiting = reviewTasks(stageText, stage);
  if (waiting.length > 1 && (context.state.streams ?? 1) > 1)
    return step(await park(context, `many:${task}`, `ждут ревью сразу ${waiting.join(', ')}`));
  const [review] = waiting;
  if (review === undefined) return followUp(context, task, work.message, accepted);
  if (review !== task) {
    context.config.board?.task(agentName(context), review);
    await context.say(`${firstLine(prompt)} взял ${review} вместо ${task}`);
  }
  const violation = await specViolation(context, review);
  if (violation !== undefined) return step(await park(context, `spec:${review}`, violation));
  return { kind: 'review', task: review };
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
  config.board?.task(agentName(context), task);
  // Доделка всегда начинается с работы: `[~]` в незакоммиченном файле этапа ещё не проверен.
  let needsWork = options.resume === true || options.mark !== '~';
  let prompt = options.resume === true ? resumePrompt(task) : options.workPrompt;
  let followUps = 0;
  let skipRetried = false;
  const writesSpec = options.spec ?? options.workPrompt === '$next';
  for (let round = 1; round <= config.maxRounds;) {
    if (needsWork && writesSpec) {
      if (round === 1 && prompt === options.workPrompt && specEnabled(context))
        await pendingSpecReturn(context, current);
      const stop = await prepareSpec(context, current, prompt === options.workPrompt);
      if (stop !== undefined) return { step: stop, done: false };
    }
    const work = needsWork
      ? await runWork(context, current, prompt, accepted)
      : { kind: 'review' as const, task: current };
    if (work.kind === 'review') current = work.task;
    prompt = options.workPrompt;
    // Файл пункта возврата не тронут — ревью вернёт то же самое: сначала один явный повтор работы.
    const skipped =
      needsWork && work.kind === 'review' ? await skippedReturnItems(context, current) : [];
    if (skipped.length > 0) {
      if (skipRetried)
        return {
          step: await park(
            context,
            `skip:${current}`,
            `исполнитель не тронул файлы пунктов возврата ${current} даже после напоминания: ${skipped.join(' | ')} — Issue «$task ${current} <что делать>» или «$decide»`,
          ),
          done: false,
        };
      skipRetried = true;
      await say(
        `${current}: файлы пунктов возврата не тронуты — повторяю работу со списком пунктов`,
      );
      prompt = skippedPrompt(current, skipped);
      continue;
    }
    const checked = work.kind === 'review' ? await ciBeforeReview(context, work.task) : work;
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
      context.state.returnTotals = Object.fromEntries(
        Object.entries(context.state.returnTotals).filter(([key]) => key !== current),
      );
      config.board?.count('done');
      await say(`готово: ${current}`);
      return { step: 'worked', done: true };
    }
    // Ревью нашло, что приёмочные тесты не совпадают с задачей: их исправляет исполнитель.
    // 2026-10-14, 07/T1: ревью написало о нехватке в приёмочном тесте без `СПЕК:`, и исполнитель,
    // которому тест менять нельзя, встал. Ссылка на файл теста — тоже замечание к тестам.
    if (
      SPEC_REMARK_RE.test(verdict.message) ||
      mentionsSpec(verdict.message, specFiles(context, current))
    )
      await unlockSpec(context, current);
    else if (specEnabled(context)) await pendingSpecReturn(context, current);
    config.board?.count('returns');
    context.state.returnTotals = {
      ...context.state.returnTotals,
      [current]: (context.state.returnTotals[current] ?? 0) + 1,
    };
    await save(context);
    await say(`ВОЗВРАТ ${current}, круг ${round} из ${config.maxRounds}`);
    needsWork = true;
    round += 1;
  }
  return {
    step: await park(
      context,
      `rounds:${current}`,
      `${config.maxRounds} ВОЗВРАТ подряд по ${current}${totalNote(context, current)} — нужно решение владельца`,
    ),
    done: false,
  };
}
