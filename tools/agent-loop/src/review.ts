// Reviewer только читает локальный diff. Вердикт хранит оркестратор, stage-файл reviewer не меняет.
import { backoff, readStage, session, type LoopContext, type Step } from './context.ts';
import { dirtyFiles, head, remoteHead } from './git.ts';
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
  if (message.trimStart().startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const result = parsed as { readonly outcome?: unknown; readonly findings?: unknown };
    if (!Array.isArray(result.findings)) return undefined;
    if (result.outcome === 'OK' && result.findings.length === 0) return { ok: true, findings: [] };
    if (result.outcome !== 'ВОЗВРАТ' || result.findings.length === 0) return undefined;
    const findings = result.findings.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return [];
      const entry = item as { readonly kind?: unknown; readonly text?: unknown };
      if (
        !['КОД', 'ТЕСТ', 'ПЛАН'].includes(String(entry.kind)) ||
        typeof entry.text !== 'string' ||
        entry.text.trim() === ''
      )
        return [];
      return [{ kind: entry.kind as FindingKind, text: `${entry.kind}: ${entry.text.trim()}` }];
    });
    return findings.length === result.findings.length ? { ok: false, findings } : undefined;
  }
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
  const source = taskBlock(stage.stageText, task);
  const ownerPrompt = context.state.activeTask?.workPrompt;
  const fullInstructions = note.startsWith('Узкая')
    ? ''
    : 'Проверь каждый пункт действующего блока задачи до вердикта; один проход должен вернуть все блокеры. Для изменённых или удалённых публичных имён проверь через rg все импорты, вызовы и старые тесты; не ограничивайся новым приёмочным файлом.';
  const prompt = [
    `$review ${task}`,
    note,
    ownerPrompt?.includes('\n') ? `Исходное поручение владельца:\n${ownerPrompt}` : '',
    `Действующий текст задачи — источник ожидаемого поведения:\n${source}`,
    fullInstructions,
    'Reviewer работает только на чтение: ничего не изменяй, не коммить и не push.',
    'Ответ заполни по JSON Schema: outcome `OK` или `ВОЗВРАТ`; при OK findings пуст.',
    'При возврате перечисли все блокеры в findings с kind `КОД`, `ТЕСТ` или `ПЛАН`.',
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
