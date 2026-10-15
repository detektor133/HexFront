// `$review` задачи: сессия ревью, проверка её вердикта и сходимость повторного ревью.
import {
  backoff,
  checkPermissions,
  firstLine,
  park,
  readStage,
  save,
  session,
  type LoopContext,
  type Step,
} from './context.ts';
import { dirtyFiles, head, syncWithOrigin } from './git.ts';
import {
  outOfScopeRemarks,
  rejectedReturnNote,
  remarkLines,
  reviewScope,
  scopeNote,
  type ReviewScope,
} from './review-scope.ts';
import { specFiles, unlockedFiles } from './spec.ts';
import { taskMark } from './stage-file.ts';

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
  const files = specFiles(context, task);
  const unlocked = unlockedFiles(context, task);
  const lines = [
    `$review ${task}`,
    ...notes,
    ...(files.length === 0
      ? []
      : [`Приёмочные тесты задачи, написанные $spec до кода: ${files.join(', ')}`]),
    ...(unlocked === undefined
      ? []
      : [
          `Приёмочные тесты задачи исправлял исполнитель по возврату «СПЕК:»${unlocked.length === 0 ? '' : `: ${unlocked.join(', ')}`} — сверь их с текстом задачи заново`,
        ]),
  ];
  const review = await session(context, 'review', lines.join('\n'));
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
 * отклоняет и один раз просит ревью заново, второй такой — к владельцу.
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
      return park(
        context,
        `review:${task}`,
        `ревью дважды вернуло ${task} только по строкам тестов, которые не менялись после прошлого возврата — реши Issue «$decide»`,
        verdict.message,
      );
  }
  await remember(context, task, verdict);
  return verdict;
}
