// Сторож пропуска пунктов возврата: исполнитель не должен отправлять на ревью задачу, в которой
// файл пункта возврата не тронут после возврата.
// 2026-10-16, 07/T13: ревью три круга подряд возвращало «живой фон меню» в MainMenu.tsx, исполнитель
// делал соседние пункты, цикл видел коммит и зелёный CI и снова отправлял задачу на ревью.
import { readStage, type LoopContext } from './context.ts';
import { remarkRefs, samePath } from './review-scope.ts';
import { SPEC_REMARK_RE } from './spec.ts';
import { taskBlock } from './stage-file.ts';

const RETURN_HEAD_RE = /^\s*Возврат ревью/u;
const ITEM_RE = /^\s{2,}[-*]\s+(.*\S)/u;
// Тесты исполнитель может не менять (закрыты, отдельная ветка возврата «СПЕК:»): их не судим.
const TEST_PATH_RE = /\.test\.[cm]?[jt]sx?$|\/tests?\//u;

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

/**
 * Пункты про код продукта, у которых названы файлы `файл:строки`, и ни один из них не менялся.
 * Пункт без ссылок, «СПЕК:» и ссылки на тесты цикл судить не может — они не считаются пропуском.
 */
export function untouchedItems(items: readonly string[], touched: readonly string[]): string[] {
  return items.filter((item) => {
    if (SPEC_REMARK_RE.test(item)) return false;
    const paths = remarkRefs(item)
      .map((ref) => ref.path)
      .filter((path) => !TEST_PATH_RE.test(path));
    return paths.length > 0 && !paths.some((p) => touched.some((t) => samePath(t, p)));
  });
}

/**
 * Пункты последнего возврата задачи, файлы которых не тронуты с коммита этого возврата.
 * Коммит возврата или diff не прочитать — пусто: без данных цикл не задерживает ревью.
 */
export async function skippedReturnItems(context: LoopContext, task: string): Promise<string[]> {
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
  return untouchedItems(items, touchedPaths(diff.stdout));
}

/** Запрос работы: пункты возврата, файлы которых исполнитель не тронул. */
export const skippedPrompt = (task: string, items: readonly string[]): string =>
  [
    `$task ${task} пункты возврата ревью не выполнены`,
    'После возврата ни один файл из этих пунктов не изменён. Выполни каждый пункт в коде продукта, а не соседние:',
    ...items.map((item) => `- ${item}`),
    'Если пункт уже выполнен в другом файле или неверен — назови файл и причину в ответе.',
  ].join('\n');
