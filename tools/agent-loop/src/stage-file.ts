// Разбор docs/STATUS.md и файла этапа: очередь, блок задачи, отметки [ ]/[~]/[x]/[—].

export type TaskMark = ' ' | '~' | 'x' | '—';

const firstLine = (text: string): string => text.trim().split(/\r?\n/, 1)[0] ?? '';
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shortId = (task: string): string => task.match(/\/(T[^/\s]+)$/)?.[1] ?? task;

/** Номер задачи `NN/Tn` в тексте; хвостовая пунктуация и кавычки в номер не входят. */
export const TASK_ID_SOURCE = String.raw`\d{2}\/T[^\s\`'"«»,;:()→]*[^\s\`'"«»,;:()→.]`;

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

/**
 * @returns номера задач из строки «Очередь» по порядку. Пояснения в строке
 * («после мержа PR…») номерами не считаются.
 */
export const parseQueue = (status: string): string[] =>
  [
    ...(status.match(/Очередь:\s*([^\r\n]+)/)?.[1] ?? '').matchAll(new RegExp(TASK_ID_SOURCE, 'g')),
  ].map((match) => match[0]);

/** @returns первая задача очереди STATUS, не закрытая в файле этапа (`[ ]` или `[~]`). */
export function selectTask(status: string, stageText: string): string | undefined {
  return parseQueue(status).find((task) => {
    const mark = taskMark(stageText, task);
    return mark === ' ' || mark === '~';
  });
}

/** @returns задачи этапа с отметкой `[~]`, в порядке файла. */
export const reviewTasks = (stageText: string, stage: string): string[] =>
  [...stageText.matchAll(/^- \[~\] \*\*(T[^.\s*]+)\./gm)].map((match) => `${stage}/${match[1]}`);

/** @returns все задачи этапа с отметкой `[ ]` или `[~]`, в порядке файла. */
export const openTasks = (stageText: string, stage: string): string[] =>
  [...stageText.matchAll(/^- \[[ ~]\] \*\*(T[^.\s*]+)\./gm)].map((match) => `${stage}/${match[1]}`);

/** @returns номер текущего этапа из таблицы STATUS, например `06`. */
export const statusStage = (status: string): string | undefined =>
  status.match(/Текущий этап\s*\|\s*(\d+)/)?.[1];

/** @returns ветка из поля «Ветка» таблицы STATUS. */
export const statusBranch = (status: string): string | undefined =>
  status.match(/Ветка\s*\|\s*`([^`]+)`/)?.[1];

/**
 * Этап закрыт `$stage-close`, но ветка следующего ещё не создана: «Текущий этап»
 * уже следующий, а «Ветка» — прежняя `stage-NN`.
 */
export function closedStageBranch(status: string): string | undefined {
  const stage = statusStage(status);
  const branch = statusBranch(status);
  const branchStage = branch?.match(/^stage-(\d+)$/)?.[1];
  return stage !== undefined && branchStage !== undefined && branchStage !== stage
    ? branch
    : undefined;
}

/** @returns номер задачи после команды (`$split 06/T1` → `06/T1`) в ответе сессии. */
export function commandTask(text: string, command: string): string | undefined {
  return text.match(new RegExp(`${escapeRegExp(command)}\\s+(${TASK_ID_SOURCE})`))?.[1];
}
