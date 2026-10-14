// Выбор задач для параллельных потоков: строки `Файлы:` и `После:` блока задачи и очередь STATUS.
import { globToRegExp } from './context.ts';
import { isOwnerTask, parseQueue, taskBlock, taskMark } from './stage-file.ts';

/** Объём задачи из её блока: файлы, которые она меняет, и задачи, без которых её не начать. */
export interface TaskScope {
  /** Пути и glob (`*`, `**`); undefined — строки нет, задача пересекается со всеми. */
  readonly files?: readonly string[];
  /** Короткие номера (`T2`); undefined — строки нет, задача ждёт все задачи перед ней в очереди. */
  readonly after?: readonly string[];
}

const fieldValue = (block: string, name: string): string | undefined =>
  block.match(new RegExp(`^\\s*\\*${name}:\\*\\s*(.+)$`, 'mu'))?.[1]?.trim();

const splitList = (value: string): string[] =>
  value
    .split(/[,;]/)
    .map((item) => item.trim().replace(/^`|`$/g, '').trim())
    .filter((item) => item !== '' && item !== '—');

/** @returns объём задачи по строкам `*Файлы:*` и `*После:*` её блока. */
export function taskScope(block: string): TaskScope {
  const files = fieldValue(block, 'Файлы');
  const after = fieldValue(block, 'После');
  return {
    ...(files === undefined ? {} : { files: splitList(files) }),
    ...(after === undefined ? {} : { after: splitList(after).map(shortTask) }),
  };
}

const shortTask = (task: string): string => task.match(/(T[^/\s]+)$/)?.[1] ?? task;

/** Часть пути до первого `*`: всё, что glob может совпасть, начинается с неё. */
const literalPrefix = (glob: string): string => glob.split('*', 1)[0] ?? '';

/**
 * Два пути или glob могут задеть один файл. Сравнение по части до первого `*` — с запасом:
 * лишнее пересечение даёт только очередь, пропущенное — конфликт слияния.
 */
export function globsOverlap(left: string, right: string): boolean {
  const a = literalPrefix(left);
  const b = literalPrefix(right);
  const wildA = a !== left;
  const wildB = b !== right;
  if (!wildA && !wildB) return a === b;
  if (wildA && wildB) return a.startsWith(b) || b.startsWith(a);
  return wildA ? b.startsWith(a) : a.startsWith(b);
}

/** @returns true, если задачи нельзя вести одновременно: у одной нет `Файлы:` или пути пересекаются. */
export function scopesOverlap(left: TaskScope, right: TaskScope): boolean {
  if (left.files === undefined || right.files === undefined) return true;
  return left.files.some((a) => right.files?.some((b) => globsOverlap(a, b)) === true);
}

const closed = (stageText: string, task: string): boolean => {
  const mark = taskMark(stageText, task);
  return mark === 'x' || mark === '—';
};

/** Все зависимости задачи закрыты в файле этапа ветки этапа. */
function ready(queue: readonly string[], stageText: string, task: string): boolean {
  const { after } = taskScope(taskBlock(stageText, task));
  const stage = task.split('/', 1)[0] ?? '';
  const needed =
    after === undefined ? queue.slice(0, queue.indexOf(task)) : after.map((t) => `${stage}/${t}`);
  return needed.every((dependency) => closed(stageText, dependency));
}

/**
 * Следующая задача для свободного потока: первая в «Очереди», открытая (`[ ]`/`[~]`), не
 * задача владельца, с закрытыми зависимостями и без пересечения файлов с задачами в работе.
 * @param busy задачи, которые сейчас держат потоки (в работе, ждут слияния или владельца).
 */
export function selectStreamTask(
  status: string,
  stageText: string,
  busy: readonly string[],
): string | undefined {
  const queue = parseQueue(status);
  const busyScopes = busy.map((task) => taskScope(taskBlock(stageText, task)));
  return queue.find((task) => {
    const mark = taskMark(stageText, task);
    if ((mark !== ' ' && mark !== '~') || busy.includes(task)) return false;
    const block = taskBlock(stageText, task);
    if (isOwnerTask(block) || !ready(queue, stageText, task)) return false;
    const scope = taskScope(block);
    return busyScopes.every((other) => !scopesOverlap(scope, other));
  });
}

/**
 * Служебные docs, которые меняет любая задача (отметки этапа, отчёт, BUGS, DECISIONS, QUESTIONS):
 * они не объём задачи и не повод для повторного ревью. Тот же список, что docs-only CI
 * (`tools/ci-wait/src/docs-only.ts`).
 */
const SERVICE_DOCS_RE =
  /^docs\/(stages\/.+|reports\/.+|STATUS\.md|BUGS\.md|QUESTIONS\.md|DECISIONS\.md|CHANGELOG-proposals\.md)$/;

/** @returns пути без служебных docs. */
export const workFiles = (paths: readonly string[]): string[] =>
  paths.filter((path) => !SERVICE_DOCS_RE.test(path));

/** @returns файлы, которые меняла задача, но которых нет в её `Файлы:` (пусто — объём соблюдён). */
export function outsideScope(scope: TaskScope, changed: readonly string[]): string[] {
  if (scope.files === undefined) return [];
  const patterns = scope.files.map(globToRegExp);
  return workFiles(changed).filter((path) => !patterns.some((pattern) => pattern.test(path)));
}
