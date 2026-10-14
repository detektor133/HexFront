// Недоделанная работа задачи, которая ждёт ответа владельца, откладывается в git stash на время
// его Issue: `$decide` и `$bug` коммитят в чистом дереве, а работа возвращается и продолжается.
// 2026-10-14, 07/T3: исполнитель спросил владельца, а ответ (`$decide`) при грязном дереве не
// исполнялся — цикл ждал ответа, который сам же не мог принять.
import { firstLine, park, save, type LoopContext, type Step } from './context.ts';
import { changedPaths } from './git.ts';
import { clean } from './screen-text.ts';

/** Сколько знаков вопроса исполнителя видно в причине ожидания: целиком он в журнале и логе. */
const QUESTION_SHOWN = 300;

const shelfMessage = (task: string): string => `agent-loop ${task}: работа ждёт ответа владельца`;

/** Итог возврата работы: конфликт — часть файлов с маркерами слияния, их разрешает исполнитель. */
export type Unshelved =
  | { readonly kind: 'none' }
  | { readonly kind: 'restored'; readonly task: string }
  | { readonly kind: 'conflict'; readonly task: string; readonly files: readonly string[] }
  | { readonly kind: 'refused'; readonly task: string; readonly reason: string };

/** Откладывает всю незакоммиченную работу задачи (с новыми файлами). @returns false — не удалось. */
export async function shelveWork(context: LoopContext, task: string): Promise<boolean> {
  const stashed = await context.git.attempt([
    'stash',
    'push',
    '--include-untracked',
    '-m',
    shelfMessage(task),
  ]);
  if (stashed.code !== 0) {
    await context.say(`работа ${task} не отложена: ${stashed.stderr.trim()}`);
    return false;
  }
  context.state.shelved = task;
  await save(context);
  await context.say(`работа ${task} отложена на время ответа владельца`);
  return true;
}

/** Ссылка `stash@{N}` на отложенную работу задачи; нет — undefined. */
async function shelfRef(context: LoopContext, task: string): Promise<string | undefined> {
  const list = await context.git.run(['stash', 'list', '--format=%gd%x09%gs']);
  return list
    .split(/\r?\n/u)
    .map((line) => line.split('\t'))
    .find(([, subject]) => subject?.endsWith(shelfMessage(task)))?.[0];
}

/**
 * Возвращает отложенную работу в дерево. Вызывается сразу после Issue и при старте цикла: работа,
 * отложенная до обрыва цикла, не должна остаться в stash незамеченной.
 */
export async function unshelveWork(context: LoopContext): Promise<Unshelved> {
  const task = context.state.shelved;
  if (task === undefined) return { kind: 'none' };
  const forget = async (): Promise<void> => {
    delete context.state.shelved;
    await save(context);
  };
  const ref = await shelfRef(context, task);
  if (ref === undefined) {
    await forget();
    return { kind: 'none' };
  }
  const before = new Set(await changedPaths(context.git));
  const popped = await context.git.attempt(['stash', 'pop', ref]);
  if (popped.code === 0) {
    await forget();
    return { kind: 'restored', task };
  }
  const unmerged = (await context.git.run(['diff', '--name-only', '--diff-filter=U']))
    .split(/\r?\n/u)
    .filter(Boolean);
  if (unmerged.length === 0) {
    // Ничего не применилось (например, новый файл с тем же именем уже есть): работа цела в stash.
    const changed = (await changedPaths(context.git)).filter((path) => !before.has(path));
    return {
      kind: 'refused',
      task,
      reason: `${popped.stderr.trim() || popped.stdout.trim()}${changed.length > 0 ? ` (изменены: ${changed.join(', ')})` : ''}`,
    };
  }
  // Конфликт: работа уже в дереве с маркерами слияния, а stash git при конфликте не удаляет.
  await context.git.run(['stash', 'drop', ref]);
  await forget();
  return { kind: 'conflict', task, files: unmerged };
}

/**
 * Доделка остановилась с незакоммиченной работой — это вопрос или блокер владельцу. Ответ —
 * Issue `$decide` (или `$bug`): цикл исполнит её, отложив работу, и продолжит задачу сам.
 */
export async function waitForAnswer(
  context: LoopContext,
  task: string,
  answer: string,
): Promise<Step> {
  const question = clean(firstLine(answer)).slice(0, QUESTION_SHOWN);
  const reason = `${task} ждёт твоего ответа: «${question || 'см. лог сессии'}». Ответ — Issue «$decide» с решением; работа задачи останется и продолжится сама`;
  context.state.waitingAnswer = { task, reason };
  await save(context);
  return park(context, `resume:${task}`, reason, answer);
}

/** Запрос доделки со строкой об ответе владельца, если он пришёл, пока работа ждала. */
export async function withAnswer(
  context: LoopContext,
  prompt: string,
  resume: string,
): Promise<string> {
  const note = context.state.resumeNote;
  if (prompt !== resume || note === undefined) return prompt;
  delete context.state.resumeNote;
  await save(context);
  return `${prompt}\n${note}`;
}
