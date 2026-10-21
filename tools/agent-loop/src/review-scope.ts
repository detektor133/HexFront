// Сходимость повторного ревью: новое `СПЕК:` — только к строкам, изменённым после прошлого возврата.
// 2026-10-15, 07/T7: правило было только в промпте ревью; свежая сессия не знала, что уже видела,
// переименованный файл тестов выглядел целиком новым, и задача 13 раз возвращалась по строкам,
// которые прошлые ревью видели и не вернули (числа 91/157/303 в DOM-тесте, суффикс файла).
import type { Git } from './git.ts';
import { SPEC_REMARK_RE } from './spec.ts';
import { taskBlock } from './stage-file.ts';

/** Строки файла включительно, с 1. */
export type LineRange = readonly [number, number];

/** Изменения от коммита прошлого возврата до HEAD: новые пути → строки; старый путь → новый. */
export interface ChangedLines {
  readonly ranges: Readonly<Record<string, readonly LineRange[]>>;
  readonly renames: Readonly<Record<string, string>>;
}

/**
 * Что ревью разрешено замечать в тестах: `first` — первое ревью задачи; `reset` — текст задачи
 * изменён после прошлого возврата (новые критерии дают новые замечания); `narrow` — только
 * изменённые строки и строки, названные прошлыми возвратами.
 */
export type ReviewScope =
  | { readonly kind: 'first' }
  | { readonly kind: 'reset'; readonly base: string }
  | {
      readonly kind: 'narrow';
      readonly base: string;
      readonly changed: ChangedLines;
      readonly previous: readonly RemarkRef[];
    };

/** Ссылка замечания на файл и строки: `apps/client/test/x.test.ts:47-57,90`. */
export interface RemarkRef {
  readonly path: string;
  readonly ranges: readonly LineRange[];
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u;
const REF_RE = /([\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z]\w*):(\d+(?:-\d+)?(?:,\s?\d+(?:-\d+)?)*)/gu;
const RETURN_HEAD_RE = /^\s*Возврат ревью/u;
const AUDIT_BLOCK_HEAD_RE = /^\s*(?:Возврат ревью(?:[^:]*)?|ИСПРАВЛЕНО ПО РЕВЬЮ)\s*:\s*$/iu;
const AUDIT_LINE_RE =
  /^\s*(?:Исправлено(?:\s|:|\()|Повторное ревью|Замечание ревью|Возврат ревью исправлен)/iu;
const LIST_ITEM_RE = /^\s*[-*]\s+\S/u;

/**
 * Разбор `git diff -M --unified=0`: строки нового файла, которые добавлены или изменены.
 * Удаление строк отмечает соседние строки: проверка рядом с ними тоже изменилась.
 */
export function parseChangedLines(diff: string): ChangedLines {
  const ranges: Record<string, LineRange[]> = {};
  const renames: Record<string, string> = {};
  let current: string | undefined;
  let renameFrom: string | undefined;
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith('diff --git ')) {
      current = undefined;
      renameFrom = undefined;
    } else if (line.startsWith('rename from ')) renameFrom = line.slice('rename from '.length);
    else if (line.startsWith('rename to ') && renameFrom !== undefined)
      renames[renameFrom] = line.slice('rename to '.length);
    else if (line.startsWith('+++ ')) {
      const path = line.slice(4);
      current = path === '/dev/null' ? undefined : path.replace(/^b\//u, '');
    } else if (current !== undefined) {
      const hunk = HUNK_RE.exec(line);
      if (hunk === null) continue;
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const range: LineRange =
        count === 0 ? [Math.max(start, 1), start + 1] : [start, start + count - 1];
      (ranges[current] ??= []).push(range);
    }
  }
  return { ranges, renames };
}

/** Ссылки `файл:строки` в строке замечания. */
export function remarkRefs(text: string): RemarkRef[] {
  return [...text.matchAll(REF_RE)].map((match) => ({
    path: match[1] ?? '',
    ranges: (match[2] ?? '').split(',').map((part): LineRange => {
      const [from = '0', to = from] = part.trim().split('-');
      return [Number(from), Number(to)];
    }),
  }));
}

/** Путь из замечания и путь из diff — один файл: совпадают или один — хвост другого. */
export const samePath = (a: string, b: string): boolean =>
  a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

const overlaps = (a: readonly LineRange[], b: readonly LineRange[]): boolean =>
  a.some(([from, to]) => b.some(([start, end]) => from <= end && start <= to));

/** Ссылка попадает в изменённые строки или в строки, уже названные прошлым возвратом. */
function refInScope(ref: RemarkRef, scope: Extract<ReviewScope, { kind: 'narrow' }>): boolean {
  const changed = Object.entries(scope.changed.ranges).some(
    ([path, ranges]) => samePath(path, ref.path) && overlaps(ranges, ref.ranges),
  );
  return (
    changed ||
    scope.previous.some((old) => samePath(old.path, ref.path) && overlaps(old.ranges, ref.ranges))
  );
}

/** Строки замечаний к тестам со ссылками вне разрешённого повторного diff. */
export function outOfScopeRemarks(message: string, scope: ReviewScope): string[] {
  if (scope.kind !== 'narrow') return [];
  return message
    .split(/\r?\n/u)
    .filter((line) => SPEC_REMARK_RE.test(line))
    .filter((line) => {
      const refs = remarkRefs(line);
      return refs.length > 0 && !refs.some((ref) => refInScope(ref, scope));
    })
    .map((line) => line.trim());
}

/** Пункты списка замечаний в ответе ревью (после строки вердикта). */
export const remarkLines = (message: string): string[] =>
  message
    .split(/\r?\n/u)
    .slice(1)
    .filter((line) => LIST_ITEM_RE.test(line))
    .map((line) => line.trim());

/** Блок задачи без отметки и журнала исполнения/ревью: изменился он — изменились критерии. */
export function taskText(block: string): string {
  const kept: string[] = [];
  let inAuditBlock = false;
  for (const line of block.replace(/^- \[[^\]]\]/u, '- []').split(/\r?\n/u)) {
    if (AUDIT_BLOCK_HEAD_RE.test(line)) {
      inAuditBlock = true;
      continue;
    }
    if (inAuditBlock && /^\s*[-*]\s+\S/u.test(line)) continue;
    if (inAuditBlock && line.trim() === '') continue;
    inAuditBlock = false;
    if (AUDIT_LINE_RE.test(line)) continue;
    kept.push(line.trimEnd());
  }
  return kept
    .filter((line) => line.trim() !== '')
    .join('\n')
    .trim();
}

/** Ссылки всех пунктов возвратов в блоке задачи, пути — после переименований. */
export function previousRefs(block: string, renames: ChangedLines['renames']): RemarkRef[] {
  const refs: RemarkRef[] = [];
  let inReturn = false;
  for (const line of block.split(/\r?\n/u)) {
    if (RETURN_HEAD_RE.test(line)) inReturn = true;
    else if (inReturn && /^\s{2,}[-*]\s/u.test(line)) refs.push(...remarkRefs(line));
    else inReturn = false;
  }
  return refs.map((ref) => {
    const renamed = Object.entries(renames).find(([from]) => samePath(from, ref.path));
    return renamed === undefined ? ref : { ...ref, path: renamed[1] };
  });
}

/**
 * Разрешённое повторному ревью по коммиту прошлого возврата `base`. Нет коммита в истории
 * (переписанная ветка) или diff не прочитать — `first`: ревью без ограничений, как раньше.
 * @param stagePath путь файла этапа от корня репозитория.
 */
export async function reviewScope(
  git: Git,
  task: string,
  base: string | undefined,
  stagePath: string,
  currentStage: string,
): Promise<ReviewScope> {
  if (base === undefined) return { kind: 'first' };
  const before = await git.attempt(['show', `${base}:${stagePath}`]);
  if (before.code !== 0) return { kind: 'first' };
  const oldBlock = taskBlock(before.stdout, task);
  if (oldBlock === '' || taskText(oldBlock) !== taskText(taskBlock(currentStage, task)))
    return { kind: 'reset', base };
  const diff = await git.attempt(['diff', '-M', '--unified=0', '--no-color', base, 'HEAD']);
  if (diff.code !== 0) return { kind: 'first' };
  const changed = parseChangedLines(diff.stdout);
  return { kind: 'narrow', base, changed, previous: previousRefs(oldBlock, changed.renames) };
}

const MAX_NOTE_FILES = 30;
const formatRanges = (ranges: readonly LineRange[]): string =>
  ranges.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(',');

/** Строки запроса `$review`: что ревью разрешено замечать в тестах. */
export function scopeNote(scope: ReviewScope): string[] {
  const short = (sha: string): string => sha.slice(0, 8);
  if (scope.kind === 'first') return [];
  if (scope.kind === 'reset')
    return [
      `Текст задачи изменён после прошлого возврата (коммит ${short(scope.base)}): ревью по новому тексту целиком.`,
    ];
  const files = Object.entries(scope.changed.ranges);
  const listed = files
    .slice(0, MAX_NOTE_FILES)
    .map(([path, ranges]) => `${path}:${formatRanges(ranges)}`);
  const renames = Object.entries(scope.changed.renames).map(([from, to]) => `${from} → ${to}`);
  return [
    `Повторное ревью: прошлый возврат — коммит ${short(scope.base)}. Строки, изменённые после него (git diff -M ${short(scope.base)}..HEAD): ${listed.length === 0 ? 'нет' : listed.join('; ')}${files.length > MAX_NOTE_FILES ? `; и ещё ${files.length - MAX_NOTE_FILES} файлов` : ''}.`,
    ...(renames.length === 0 ? [] : [`Переименованы (это не новые файлы): ${renames.join('; ')}.`]),
    'Новое замечание — только к этим строкам или к пунктам прошлых возвратов, со ссылкой файл:строки; цикл сверяет ссылки и отклоняет повтор без нового diff.',
  ];
}

/** Запрос повторного ревью, когда цикл отклонил возврат целиком. */
export const rejectedReturnNote = (base: string, remarks: readonly string[]): string =>
  [
    `Цикл отклонил твой ВОЗВРАТ: все замечания ссылаются на строки, которые не менялись после прошлого возврата (коммит ${base.slice(0, 8)}) и не назывались в прошлых возвратах (правило сходимости $review):`,
    ...remarks,
    'Отметка задачи сейчас [ ]. Проверь задачу без этих замечаний. При OK поставь [x] и удали последний блок «Возврат ревью:» с ними; при ВОЗВРАТ по другим причинам — замени этот блок своим списком, как обычно.',
  ].join('\n');
