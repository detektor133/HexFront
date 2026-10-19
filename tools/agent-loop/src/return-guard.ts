// Возврат reviewer хранится в файле этапа и дословно передаётся следующему исполнителю.
// Решение о том, исправлен ли пункт, принимает только повторный reviewer по коду и тестам:
// оркестратор не выводит смысл исправления из свободного русского отчёта исполнителя.

const RETURN_HEAD_RE = /^\s*Возврат ревью/u;
const ITEM_RE = /^\s*[-*]\s+(.*\S)/u;

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
    'До отметки [~] выполни каждый пункт возврата, включая СПЕК, и проверь исправление тестом.',
    'Итоговый ответ нужен владельцу как краткий отчёт; оркестратор не разбирает его текст и не принимает по нему решений.',
  ].join('\n');
};
