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
import { commandTask, reviewTasks, taskMark } from './stage-file.ts';

/** Итог сессии работы: задача на ревью, повторить работу или шаг цикла. */
type Work =
  | { readonly kind: 'review'; readonly task: string }
  | { readonly kind: 'again' }
  | { readonly kind: 'step'; readonly step: Step };
export interface TaskRun {
  readonly step: Step;
  /** Задача прошла ревью и стала `[x]`. */
  readonly done: boolean;
}

/** Сколько раз за круги одной задачи цикл сам повторяет работу после `$accept` или красного CI. */
const MAX_FOLLOW_UPS = 2;

export const resumePrompt = (task: string): string => `$task ${task} продолжить`;
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

/** Сессия работы над задачей; незакоммиченная работа доделывается одной сессией `продолжить`. */
async function runWork(
  context: LoopContext,
  task: string,
  prompt: string,
  accepted: Set<string>,
): Promise<Work> {
  const { git, state } = context;
  const base = await head(git);
  const work = await session(context, 'next', prompt);
  const dirty = (await dirtyFiles(git)) !== '';
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
  if ((await head(git)) !== base && !(await waitCi(context, `после ${firstLine(prompt)}`)))
    return { kind: 'again' };
  const { stage, stageText } = await readStage(context.config.root);
  const waiting = reviewTasks(stageText, stage);
  if (waiting.length > 1)
    return step(await park(context, `many:${task}`, `ждут ревью сразу ${waiting.join(', ')}`));
  const [review] = waiting;
  if (review === undefined) return followUp(context, task, work.message, accepted);
  if (review !== task) await context.say(`${firstLine(prompt)} взял ${review} вместо ${task}`);
  return { kind: 'review', task: review };
}

/** `$review` в новой сессии; возвращает новую отметку задачи или шаг цикла. */
async function runReview(context: LoopContext, task: string): Promise<'x' | ' ' | Step> {
  const { git } = context;
  const base = await head(git);
  const review = await session(context, 'review', `$review ${task}`);
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
  const verdict = firstLine(review.message);
  if (mark === 'x' && verdict === 'OK') return 'x';
  if (mark === ' ' && verdict.startsWith('ВОЗВРАТ')) return ' ';
  return park(
    context,
    `review:${task}`,
    `ответ $review «${verdict}» не совпадает с отметкой [${mark ?? '?'}]`,
    review.message,
  );
}

/**
 * Круги одной задачи, не больше maxRounds ВОЗВРАТ. `workPrompt` — `$next` для очереди
 * или `$task NN/Tn` для Issue; `resume` — начать с доделки незакоммиченной работы.
 */
export async function processTask(
  context: LoopContext,
  task: string,
  options: { readonly mark: string; readonly workPrompt: string; readonly resume?: boolean },
): Promise<TaskRun> {
  const { config, say } = context;
  const accepted = new Set<string>();
  let current = task;
  let needsWork = options.mark !== '~';
  let prompt = options.resume === true ? resumePrompt(task) : options.workPrompt;
  let followUps = 0;
  for (let round = 1; round <= config.maxRounds;) {
    if (needsWork) {
      const work = await runWork(context, current, prompt, accepted);
      prompt = options.workPrompt;
      if (work.kind === 'step') return { step: work.step, done: false };
      if (work.kind === 'again') {
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
        continue;
      }
      current = work.task;
    }
    const verdict = await runReview(context, current);
    if (verdict === 'x') {
      await say(`готово: ${current}`);
      return { step: 'worked', done: true };
    }
    if (verdict !== ' ') return { step: verdict, done: false };
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
