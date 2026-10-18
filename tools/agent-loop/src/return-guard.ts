// Сторож пропуска пунктов возврата: исполнитель не должен отправлять на ревью задачу, в которой
// файл пункта возврата не тронут после возврата.
// 2026-10-16, 07/T13: ревью три круга подряд возвращало «живой фон меню» в MainMenu.tsx, исполнитель
// делал соседние пункты, цикл видел коммит и зелёный CI и снова отправлял задачу на ревью.
import { readStage, type LoopContext } from './context.ts';
import { remarkRefs, samePath } from './review-scope.ts';
import { SPEC_REMARK_RE, specFiles } from './spec.ts';
import { taskBlock } from './stage-file.ts';

const RETURN_HEAD_RE = /^\s*Возврат ревью/u;
const ITEM_RE = /^\s*[-*]\s+(.*\S)/u;
const REPORT_HEAD_RE = /^\s*#{0,3}\s*ИСПРАВЛЕНО ПО РЕВЬЮ\s*:?\s*$/iu;
const REPORT_ITEM_RE = /^\s*[-*]\s+(.*\S)/u;
const PATH_RE = /[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z]\w*/gu;
const EVIDENCE_RE = /(?:тест|провер|verify|команд|коммит)/iu;
const RED_RE = /(?:\bRED\b|красн|падает|упал|failed assertion)/iu;
const GREEN_RE = /(?:\bGREEN\b|зел[её]н|проходит|passed|\d+\/\d+)/iu;

/** Пункты последнего блока «Возврат ревью:» задачи. */
export function lastReturnItems(block: string): string[] {
  let items: string[] = [];
  let inReturn = false;
  for (const line of block.split(/\r?\n/u)) {
    if (RETURN_HEAD_RE.test(line)) {
      items = [];
      inReturn = true;
    } else if (inReturn) {
      const item = ITEM_RE.exec(line)?.[1];
      if (item === undefined) inReturn = false;
      else items.push(item);
    }
  }
  return items;
}

/** Пути из `git diff -M --name-status`: при переименовании — и старый, и новый. */
export const touchedPaths = (nameStatus: string): string[] =>
  nameStatus
    .split(/\r?\n/u)
    .flatMap((line) => line.split('\t').slice(1))
    .filter((path) => path !== '');

/** Пункты обязательного отчёта исполнителя после заголовка «ИСПРАВЛЕНО ПО РЕВЬЮ». */
export function reviewResolutionItems(message: string): string[] {
  const items: string[] = [];
  let inReport = false;
  for (const line of message.split(/\r?\n/u)) {
    if (REPORT_HEAD_RE.test(line)) inReport = true;
    else if (inReport) {
      const item = REPORT_ITEM_RE.exec(line)?.[1];
      if (item !== undefined) items.push(item);
      else if (/^\s*#/u.test(line)) inReport = false;
    }
  }
  return items;
}

const pathsIn = (text: string): string[] => [...text.matchAll(PATH_RE)].map(([path = '']) => path);

/** СПЕК закрыт только если один пункт отчёта называет тест и доказывает RED до исправления и GREEN после. */
export function hasSpecRegressionProof(item: string, message: string): boolean {
  if (!SPEC_REMARK_RE.test(item)) return true;
  const expected = remarkRefs(item).map((ref) => ref.path);
  return reviewResolutionItems(message).some((resolution) => {
    const mentioned = pathsIn(resolution);
    const namesTest =
      expected.length === 0 ||
      expected.some((path) => mentioned.some((candidate) => samePath(path, candidate)));
    return namesTest && RED_RE.test(resolution) && GREEN_RE.test(resolution);
  });
}

/**
 * Исполнитель явно перенёс исправление в другой файл: в одном пункте отчёта названы исходный
 * файл замечания, реально изменённый альтернативный файл и тест/проверка. Смысл решения после
 * этого судит reviewer; сторож проверяет только отсутствие молчаливого пропуска.
 */
export function resolvedElsewhere(
  item: string,
  message: string,
  touched: readonly string[],
): boolean {
  const expected = remarkRefs(item).map((ref) => ref.path);
  if (expected.length === 0) return false;
  return reviewResolutionItems(message).some((resolution) => {
    if (!EVIDENCE_RE.test(resolution)) return false;
    const mentioned = pathsIn(resolution);
    const namesOriginal = expected.some((path) =>
      mentioned.some((candidate) => samePath(path, candidate)),
    );
    const namesTouchedAlternative = mentioned.some(
      (candidate) =>
        touched.some((path) => samePath(path, candidate)) &&
        !expected.some((path) => samePath(path, candidate)),
    );
    return namesOriginal && namesTouchedAlternative;
  });
}

/**
 * Пункты, у которых названы файлы `файл:строки`, и ни один из них не менялся. Пункт без ссылок и
 * ссылки на закрытые приёмочные тесты задачи (их исполнитель пока не может тронуть) цикл не судит.
 * Открытый возвратом `СПЕК:` тест судится как код продукта: иначе исполнитель может снова отдать
 * ревью тот же фиктивный тест, вообще его не изменив.
 */
export function untouchedItems(
  items: readonly string[],
  touched: readonly string[],
  locked: readonly string[] = [],
  resolution = '',
): string[] {
  return items.filter((item) => {
    const paths = remarkRefs(item)
      .map((ref) => ref.path)
      .filter((path) => !locked.some((l) => samePath(l, path)));
    const untouched =
      paths.length > 0 &&
      !paths.some((p) => touched.some((t) => samePath(t, p))) &&
      !resolvedElsewhere(item, resolution, touched);
    return untouched || !hasSpecRegressionProof(item, resolution);
  });
}

/** Дословный возврат reviewer как обязательный контракт следующей сессии исполнителя. */
export const withReviewFeedback = (prompt: string, task: string, feedback?: string): string => {
  if (feedback === undefined || feedback.trim() === '') return prompt;
  const [first = prompt, ...rest] = prompt.split('\n');
  const command =
    first === '$next' || first === `$task ${task}`
      ? `$task ${task} исправить возврат ревью`
      : first;
  const prepared = [command, ...rest].join('\n');
  const exact = feedback.replace(/\n\(последний ответ не записан: [^\n]*\)\s*$/u, '');
  return [
    prepared,
    '',
    'ОБЯЗАТЕЛЬНЫЙ ВОЗВРАТ REVIEWER — это главный объём этой сессии:',
    exact.trim(),
    '',
    'До отметки [~]:',
    '1. Выполни каждый пункт возврата, включая СПЕК; не заменяй его соседней правкой или новым форматом проверки.',
    '2. Для каждого СПЕК временно воспроизведи конкретную регрессию из замечания: целевой тест обязан упасть по assertion (RED); восстанови исправление и получи GREEN.',
    '3. В итоговом ответе дай раздел «ИСПРАВЛЕНО ПО РЕВЬЮ»: каждый пункт → файлы → RED с конкретной регрессией и командой → GREEN с той же командой.',
    'Если пункт неверен или уже выполнен в другом месте — не игнорируй его: назови доказательство и точный файл.',
  ].join('\n');
};

/**
 * Пункты последнего возврата задачи, файлы которых не тронуты с коммита этого возврата.
 * Коммит возврата или diff не прочитать — пусто: без данных цикл не задерживает ревью.
 */
export async function skippedReturnItems(
  context: LoopContext,
  task: string,
  resolution = '',
): Promise<string[]> {
  const base = context.state.reviewReturns[task];
  if (base === undefined) return [];
  const { git } = context;
  const { path } = await readStage(context.config.root);
  const before = await git.attempt(['show', `${base}:${path}`]);
  if (before.code !== 0) return [];
  const items = lastReturnItems(taskBlock(before.stdout, task));
  if (items.length === 0) return [];
  const diff = await git.attempt(['diff', '-M', '--name-status', '--no-color', base, 'HEAD']);
  if (diff.code !== 0 || diff.stdout.trim() === '') return [];
  return untouchedItems(items, touchedPaths(diff.stdout), specFiles(context, task), resolution);
}

/** Запрос работы: пункты возврата, файлы которых исполнитель не тронул. */
export const skippedPrompt = (task: string, items: readonly string[]): string =>
  [
    `$task ${task} пункты возврата ревью не доказаны`,
    'Для этих пунктов нет изменения адресного файла или обязательного RED/GREEN-доказательства. Закрой каждый пункт, а не соседний:',
    ...items.map((item) => `- ${item}`),
    'Для СПЕК в одном пункте отчёта назови тест, временную регрессию, RED-команду с падением assertion и GREEN той же команды после восстановления.',
    'Если пункт выполнен в другом файле, назови исходный файл, реально изменённый файл и проверяющую команду.',
    'Если пункт неверен — назови точную причину и доказательство в ответе.',
  ].join('\n');
