// Разбор docs/STATUS.md и файла этапа: очередь, блок задачи, отметки [ ]/[~]/[x]/[—].

export type TaskMark = ' ' | '~' | 'x' | '—';

const firstLine = (text: string): string => text.trim().split(/\r?\n/, 1)[0] ?? '';
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shortId = (task: string): string => task.match(/\/(T[^/\s]+)$/)?.[1] ?? task;

/**
 * Задача владельца по первой строке блока: «задача владельца» или «плейтест».
 * «не задача владельца» и упоминания `$accept` в приёмке задачей владельца не считаются:
 * такие задачи решает сам `$next`.
 */
export const isOwnerTask = (block: string): boolean =>
  /(?<!не )задача владельца|плейтест/i.test(firstLine(block));

/** @returns блок задачи NN/Tn от её строки до следующей задачи, или пустая строка. */
export function taskBlock(stageText: string, task: string): string {
  const start = stageText.search(
    new RegExp(`^- \\[[^\\]]\\] \\*\\*${escapeRegExp(shortId(task))}\\.`, 'm'),
  );
  if (start < 0) return '';
  const next = stageText.slice(start + 1).search(/^- \[[^\]]\] \*\*T/m);
  return stageText.slice(start, next < 0 ? undefined : start + 1 + next);
}

/** @returns отметка задачи в файле этапа или undefined, если задачи нет. */
export function taskMark(stageText: string, task: string): TaskMark | undefined {
  const mark = taskBlock(stageText, task).match(/^- \[([^\]])\]/)?.[1];
  return mark === ' ' || mark === '~' || mark === 'x' || mark === '—' ? mark : undefined;
}

/** @returns первая задача очереди STATUS, не закрытая в файле этапа (`[ ]` или `[~]`). */
export function selectTask(status: string, stageText: string): string | undefined {
  const queue = status
    .match(/Очередь:\s*([^\r\n]+)/)?.[1]
    ?.split('→')
    .map((item) => item.trim())
    .filter(Boolean);
  return queue?.find((task) => {
    const mark = taskMark(stageText, task);
    return mark === ' ' || mark === '~';
  });
}

/** @returns задачи этапа с отметкой `[~]`, в порядке файла. */
export const reviewTasks = (stageText: string, stage: string): string[] =>
  [...stageText.matchAll(/^- \[~\] \*\*(T[^.\s*]+)\./gm)].map((match) => `${stage}/${match[1]}`);
