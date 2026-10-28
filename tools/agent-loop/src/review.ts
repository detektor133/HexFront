// Reviewer только читает локальный diff. Вердикт хранит оркестратор, stage-файл reviewer не меняет.
import { backoff, readStage, session, type LoopContext, type Step } from './context.ts';
import { dirtyFiles, head, remoteHead } from './git.ts';
import { taskCriteriaMatrix } from './requirements.ts';
import { taskBlock } from './stage-file.ts';
import type { FindingKind } from './state.ts';

export type { FindingKind };

export interface ReviewFinding {
  readonly kind: FindingKind;
  /** Полный атомарный пункт, который получит ровно одна исправляющая сессия. */
  readonly text: string;
}

export type Verdict =
  | { readonly ok: true; readonly findings: readonly [] }
  | { readonly ok: false; readonly findings: readonly ReviewFinding[] };

const FINDING_RE = /^\s*[-*]\s*(КОД|ТЕСТ|ПЛАН):\s*(.+)$/u;

/** @returns структурированный ответ reviewer или undefined при нарушении протокола. */
export function parseReviewVerdict(message: string): Verdict | undefined {
  const lines = message.trim().split(/\r?\n/u);
  const first = lines[0]?.trim();
  if (first === 'OK') return { ok: true, findings: [] };
  if (first !== 'ВОЗВРАТ') return undefined;
  const findings = lines.flatMap((line) => {
    const match = FINDING_RE.exec(line);
    if (!match?.[1] || !match[2]) return [];
    return [{ kind: match[1] as FindingKind, text: `${match[1]}: ${match[2].trim()}` }];
  });
  return findings.length === 0 ? undefined : { ok: false, findings };
}

/** Полный или узкий review локальных коммитов без изменения дерева, HEAD и remote. */
export async function runReview(
  context: LoopContext,
  task: string,
  note = '',
): Promise<Verdict | Step> {
  const beforeHead = await head(context.git);
  const beforeRemote = await remoteHead(context.git);
  const beforeTree = await dirtyFiles(context.git);
  const stage = await readStage(context.config.root);
  const matrix = taskCriteriaMatrix(stage.stageText, task);
  const source = taskBlock(stage.stageText, task);
  const fullMatrix = note.startsWith('Узкая')
    ? ''
    : `Проверь каждый пункт матрицы до вердикта; один проход должен вернуть все блокеры. Для изменённых или удалённых публичных имён проверь через rg все импорты, вызовы и старые тесты; не ограничивайся новым приёмочным файлом:\n${matrix}`;
  const prompt = [
    `$review ${task}`,
    note,
    `Действующий текст задачи — источник ожидаемого поведения:\n${source}`,
    fullMatrix,
    'Reviewer работает только на чтение: ничего не изменяй, не коммить и не push.',
    'Ответ: первая строка `OK` или `ВОЗВРАТ`.',
    'При возврате перечисли все блокеры строками `- КОД: ...` или `- ТЕСТ: ...`.',
    'Каждый пункт атомарен: один дефект, критерий, наблюдение и файл:строка.',
    'Текст задачи и её родителя выше старых тестов: если старый тест требует противоположного ' +
      'поведения, верни ТЕСТ, а не КОД. Перед ответом удали дубли и взаимоисключающие пункты.',
  ]
    .filter(Boolean)
    .join('\n');
  const review = await session(context, 'review', prompt);
  if (review.failure !== undefined)
    return backoff(context, `$review ${task}: ${review.failure}`, review.message);
  if (
    (await head(context.git)) !== beforeHead ||
    (await remoteHead(context.git)) !== beforeRemote ||
    (await dirtyFiles(context.git)) !== beforeTree
  )
    return backoff(
      context,
      `$review ${task} изменил Git или рабочее дерево — изменения нужно проверить вручную`,
      review.message,
    );
  const verdict = parseReviewVerdict(review.message);
  if (verdict === undefined)
    return backoff(
      context,
      `$review ${task} нарушил протокол ответа — повторю автоматически`,
      review.message,
    );
  return verdict;
}
