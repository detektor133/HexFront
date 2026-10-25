// Детерминированная сверка сохранности требований: модель не может объявить
// $decide/$plan/$split успешными, если исчезла исходная строка приёмки.
// Сверка намеренно консервативна: перефразирование требует решения владельца.
import { parseQueue, taskBlock } from './stage-file.ts';

interface RequirementsState {
  readonly stageText: string;
  readonly status: string;
}

const normalize = (text: string): string =>
  text
    .replace(/\*\*/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.!?。]+$/gu, '')
    .toLocaleLowerCase('ru-RU');

const lines = (text: string): string[] =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^\x60{3}/u.test(line) && !/^#{1,6}\s/u.test(line))
    .map(normalize)
    .filter(Boolean);

/** Требования сравниваются предложениями: расширение одной строки не должно выглядеть удалением. */
const atoms = (text: string): string[] =>
  lines(text)
    .flatMap((line) => line.split(/(?<=[.!?。])\s+/u))
    .map(normalize)
    .filter(Boolean);

/** Служебные зависимости проверяются порядком очереди, а не копированием в каждую подзадачу. */
const requirements = (block: string): string[] => {
  const body = block
    .split(/\r?\n/u)
    .slice(1)
    .filter((line) => !/^\s*\*После:\*/iu.test(line));
  return [...new Set(atoms(body.join('\n')))];
};

/** Пути и пакеты из заголовка родителя могут распределяться между независимыми подзадачами. */
const scopeReferences = (block: string): string[] => {
  const heading = block.split(/\r?\n/u, 1)[0] ?? '';
  return [...heading.matchAll(/`([^`]+)`/gu)].map((match) => normalize(match[1] ?? ''));
};

const shortId = (task: string): string => task.split('/').at(-1) ?? task;
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const excerpt = (value: string): string => value.slice(0, 140);
const exactBlock = (text: string): string => text.replace(/\r\n/gu, '\n').trimEnd();

/** @returns строки, добавленные в current, либо undefined при удалении/изменении исходной строки. */
function addedLines(original: string, current: string): string[] | undefined {
  const expected = exactBlock(original).split('\n');
  const actual = exactBlock(current).split('\n');
  const added: string[] = [];
  let expectedIndex = 0;
  for (const line of actual) {
    if (line.trim() === expected[expectedIndex]?.trim()) {
      expectedIndex += 1;
    } else {
      added.push(line);
    }
  }
  return expectedIndex === expected.length ? added : undefined;
}

/**
 * Проверяет именованные разделы Issue вида "## T17s — ...".
 * Каждый непустой пункт и строка примера должны быть в СОБСТВЕННОЙ задаче,
 * а не только в трассировке или в соседней задаче.
 */
export function verifyDecisionTasks(
  issueBody: string,
  stageText: string,
): { readonly checked: number; readonly errors: readonly string[] } {
  const headings = [...issueBody.matchAll(/^##[ \t]+(T[^\s]+)[ \t]+[—–-][^\r\n]*$/gmu)];
  const errors: string[] = [];
  let checked = 0;
  for (const heading of headings) {
    const task = heading[1] ?? '';
    const remainder = issueBody.slice((heading.index ?? 0) + heading[0].length);
    const nextHeading = remainder.search(/^##\s+/mu);
    const section = nextHeading < 0 ? remainder : remainder.slice(0, nextHeading);
    const target = taskBlock(stageText, task);
    if (target === '') {
      errors.push(task + ': задача отсутствует в файле этапа');
      continue;
    }
    const normalizedTarget = normalize(target);
    for (const item of lines(section)) {
      checked += 1;
      if (!normalizedTarget.includes(item))
        errors.push(task + ': отсутствует пункт «' + excerpt(item) + '»');
    }
  }
  return { checked, errors };
}

/**
 * Разбиение допускается только с сохранением родителя, минимум двумя дочерними
 * задачами, точной заменой очереди и переносом каждого исходного требования.
 */
export function verifySplit(
  task: string,
  before: RequirementsState,
  after: RequirementsState,
): readonly string[] {
  const errors: string[] = [];
  const original = taskBlock(before.stageText, task);
  const parent = taskBlock(after.stageText, task);
  if (original === '' || parent === '') return ['исходная задача удалена или отсутствует'];
  if (original.trim() !== parent.trim()) {
    errors.push('исходная задача изменена или сокращена при разбиении');
  }

  const name = shortId(task);
  const ids = Array.from(
    after.stageText.matchAll(/^- \[[^\]]\] \*\*(T[^.\s*]+)\./gmu),
    (match) => match[1] ?? '',
  );
  const index = ids.indexOf(name);
  const childName = new RegExp('^' + escapeRegExp(name) + '[a-zа-яё](?:\\d+)?$', 'iu');
  const children: string[] = [];
  for (let i = index + 1; i < ids.length && childName.test(ids[i] ?? ''); i += 1) {
    children.push(ids[i] ?? '');
  }
  if (children.length < 2) {
    errors.push('нет двух последовательных подзадач непосредственно под родителем');
    return errors;
  }

  const previousQueue = parseQueue(before.status);
  const parentIndex = previousQueue.indexOf(task);
  const expected = [...previousQueue];
  if (parentIndex < 0) {
    errors.push('исходной задачи нет в очереди STATUS');
  } else {
    const stage = task.split('/')[0];
    const replacements = children.map((child) => `${stage}/${child}`);
    expected.splice(parentIndex, 1, ...replacements);
  }
  if (JSON.stringify(parseQueue(after.status)) !== JSON.stringify(expected)) {
    errors.push('очередь STATUS не заменяет родителя подзадачами в прежнем порядке');
  }

  const childTexts = children.map((child) => normalize(taskBlock(after.stageText, child)));
  const combinedChildren = childTexts.join(' ');
  for (const reference of scopeReferences(original)) {
    if (!combinedChildren.includes(reference))
      errors.push('область родителя не перенесена в подзадачи: «' + excerpt(reference) + '»');
  }
  const body = original.split(/\r?\n/u).slice(1);
  const exactOnce = new Set(
    lines(body.filter((line) => /приёмка|^\s*\d+[.)]\s/iu.test(line)).join('\n')),
  );
  for (const item of requirements(original)) {
    const found = childTexts.filter((text) => text.includes(item)).length;
    if (found === 0) {
      errors.push('требование не перенесено в подзадачи: «' + excerpt(item) + '»');
    }
    if (found > 1 && exactOnce.has(item)) {
      errors.push('критерий продублирован в подзадачах: «' + excerpt(item) + '»');
    }
  }
  return errors;
}

/**
 * Возвращает исходного родителя перед первой дочерней задачей, если plan удалил только его.
 * Восстановление разрешено лишь когда итоговое разбиение после вставки полностью проходит verifySplit.
 */
export function restoreMissingSplitParent(
  task: string,
  before: RequirementsState,
  after: RequirementsState,
): string | undefined {
  const original = taskBlock(before.stageText, task);
  if (original === '' || taskBlock(after.stageText, task) !== '') return undefined;

  const name = shortId(task);
  const childHeading = new RegExp(
    `^- \\[[^\\]]\\] \\*\\*${escapeRegExp(name)}[a-zа-яё](?:\\d+)?\\.`,
    'imu',
  );
  const childIndex = after.stageText.search(childHeading);
  if (childIndex < 0) return undefined;

  const repaired = `${after.stageText.slice(0, childIndex)}${original.trimEnd()}\n\n${after.stageText.slice(childIndex)}`;
  return verifySplit(task, before, { ...after, stageText: repaired }).length === 0
    ? repaired
    : undefined;
}

/** Сохранность исходных требований после $plan до передачи задачи исполнителю. */
export function verifyPlanTransition(
  task: string,
  before: RequirementsState,
  after: RequirementsState,
  outcome: string,
): readonly string[] {
  if (outcome === 'разбито') return verifySplit(task, before, after);
  const original = taskBlock(before.stageText, task);
  const current = taskBlock(after.stageText, task);
  if (original === '' || current === '') return ['исходная задача отсутствует после $plan'];
  if (outcome === 'уточнено') {
    const added = addedLines(original, current);
    if (added === undefined) {
      return ['при уточнении изменена или удалена исходная строка; разрешено только добавление'];
    }
    const firstAdded = added.find((line) => line.trim() !== '')?.trim();
    if (firstAdded?.startsWith('*Уточнение plan:*') !== true) {
      return ['добавление должно начинаться с «*Уточнение plan:*»'];
    }
    if (before.status !== after.status) return ['при уточнении изменена очередь STATUS'];
    return [];
  }
  if (original !== current || before.status !== after.status)
    return ['$plan изменил задачу или очередь, но ответил «' + outcome + '»'];
  return [];
}
