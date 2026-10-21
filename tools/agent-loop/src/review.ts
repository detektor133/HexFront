// `$review` задачи: сессия ревью, проверка её вердикта и сходимость повторного ревью.
import {
  backoff,
  checkPermissions,
  park,
  readStage,
  save,
  session,
  type LoopContext,
  type Step,
} from './context.ts';
import { dirtyFiles, head, syncWithOrigin } from './git.ts';
import { lastReturnItems } from './return-guard.ts';
import {
  outOfScopeRemarks,
  rejectedReturnNote,
  remarkLines,
  reviewScope,
  scopeNote,
  type ReviewScope,
} from './review-scope.ts';
import { taskBlock, taskMark } from './stage-file.ts';

/** Вердикт `$review`: новая отметка задачи и ответ ревью (замечания к приёмочным тестам). */
export interface Verdict {
  readonly mark: 'x' | ' ';
  readonly message: string;
}

/** Одна сессия `$review`; `notes` — строки запроса сверх команды. */
async function reviewSession(
  context: LoopContext,
  task: string,
  notes: readonly string[],
): Promise<Verdict | Step> {
  const { git } = context;
  const base = await head(git);
  const lines = [`$review ${task}`, ...notes];
  const review = await session(context, 'review', lines.join('\n'));
  const checked = await afterReview(context, task, base, review);
  if (typeof checked === 'string') return checked;
  return checked ?? repairReviewRecord(context, task, review.message, notes);
}

type ReviewRun = Awaited<ReturnType<typeof session>>;

/**
 * Проверки после сессии ревью. Источник вердикта — сохранённое состояние задачи, а не текст
 * ответа модели: `[x]` означает OK, `[ ]` вместе с блоком возврата — ВОЗВРАТ.
 */
async function afterReview(
  context: LoopContext,
  task: string,
  base: string,
  review: ReviewRun,
): Promise<Verdict | Step | undefined> {
  const { git } = context;
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
  const stage = await readStage(context.config.root);
  const mark = taskMark(stage.stageText, task);
  if (mark === 'x') return { mark, message: 'OK' };
  if (mark === ' ') {
    const items = lastReturnItems(taskBlock(stage.stageText, task));
    if (items.length > 0)
      return { mark, message: ['ВОЗВРАТ', ...items.map((item) => `- ${item}`)].join('\n') };
  }
  return undefined;
}

/**
 * Reviewer не сохранил машиночитаемое состояние в файле этапа. Новая сессия повторяет review и
 * записывает результат; свободный текст прошлой сессии используется только как диагностика.
 */
async function repairReviewRecord(
  context: LoopContext,
  task: string,
  message: string,
  notes: readonly string[],
): Promise<Verdict | Step> {
  await context.say(
    `$review ${task}: результат не записан в stage — повторяю review автоматически`,
  );
  const base = await head(context.git);
  const fix = await session(
    context,
    'review',
    [
      `$review ${task}`,
      ...notes,
      'Предыдущая сессия не записала результат в файл этапа.',
      'Проверь задачу заново и обязательно сохрани одно из состояний:',
      '- `- [x]` для OK;',
      '- `- [ ]` и непустой последний блок `Возврат ревью:` для возврата.',
      'Измени именно строку заголовка задачи без ведущих пробелов; не заменяй отметку текстом отчёта.',
      'Итоговый текст ответа не является протоколом оркестратора.',
    ].join('\n'),
  );
  const checked = await afterReview(context, task, base, fix);
  if (checked === undefined)
    return backoff(
      context,
      `$review ${task} дважды не записал результат в stage — повторю автоматически`,
      message,
    );
  return checked;
}

/**
 * Замечания возврата, которые нарушают сходимость, когда весь возврат состоит только из них.
 * Возврат, где есть хоть одно допустимое замечание, идёт исполнителю как обычно.
 */
function rejected(verdict: Verdict, scope: ReviewScope): string[] {
  if (verdict.mark !== ' ') return [];
  const outside = outOfScopeRemarks(verdict.message, scope);
  const all = remarkLines(verdict.message);
  return outside.length > 0 && all.every((line) => outside.includes(line)) ? outside : [];
}

/** Коммит последнего возврата задачи запоминается для следующего ревью; `[x]` его забывает. */
async function remember(context: LoopContext, task: string, verdict: Verdict): Promise<void> {
  const { state } = context;
  const rest = Object.fromEntries(
    Object.entries(state.reviewReturns).filter(([key]) => key !== task),
  );
  state.reviewReturns = verdict.mark === 'x' ? rest : { ...rest, [task]: await head(context.git) };
  await save(context);
}

/**
 * `$review` в новой сессии; возвращает вердикт или шаг цикла. Повторное ревью получает строки,
 * изменённые после прошлого возврата; возврат только из «СПЕК:» к другим строкам тестов цикл
 * отклоняет и просит ревью заново; повторная ошибка reviewer уходит в автоматическую паузу.
 * @param note строка запроса сверх команды (повторное ревью после слияния ветки этапа).
 */
export async function runReview(
  context: LoopContext,
  task: string,
  note = '',
): Promise<Verdict | Step> {
  const stage = await readStage(context.config.root);
  const base = context.state.reviewReturns[task];
  const scope = await reviewScope(context.git, task, base, stage.path, stage.stageText);
  const notes = [...(note === '' ? [] : [note]), ...scopeNote(scope)];
  let verdict = await reviewSession(context, task, notes);
  if (typeof verdict === 'string') return verdict;
  const outside = rejected(verdict, scope);
  if (outside.length > 0 && base !== undefined) {
    await context.say(
      `ВОЗВРАТ ${task} отклонён: «СПЕК:» к строкам, которые не менялись — ревью заново`,
    );
    verdict = await reviewSession(context, task, [...notes, rejectedReturnNote(base, outside)]);
    if (typeof verdict === 'string') return verdict;
    if (rejected(verdict, scope).length > 0)
      return backoff(
        context,
        `ревью дважды вернуло ${task} только по неизменённым строкам — повторю автоматически`,
        verdict.message,
      );
  }
  await remember(context, task, verdict);
  return verdict;
}
