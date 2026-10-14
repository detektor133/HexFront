// Приёмочные тесты до кода: сессия `$spec` (роль spec) пишет по тексту задачи только тесты,
// цикл запоминает их содержимое, исполнитель коммитит их вместе с кодом и менять не может.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  backoff,
  globToRegExp,
  park,
  save,
  session,
  type LoopContext,
  type Step,
} from './context.ts';
import { changedPaths, dirtyFiles, head } from './git.ts';

/** Без роли spec в roles.json цикл работает по-старому: `$next` сам пишет тесты задачи. */
export const specEnabled = (context: LoopContext): boolean =>
  context.definitions.roles.spec !== undefined;

/** Пути приёмочных тестов задачи; пустой список — у задачи нет проверяемых тестами критериев. */
export const specFiles = (context: LoopContext, task: string): readonly string[] =>
  Object.keys(context.state.spec[task] ?? {});

export const specPrompt = (task: string, remarks: string): string =>
  remarks === ''
    ? `$spec ${task}`
    : `$spec ${task}\nЗамечания ревью к приёмочным тестам:\n${remarks}`;

/** Промпт работы с приёмочными тестами: исполнитель знает, что они уже в дереве и закрыты. */
export const withSpec = (prompt: string, task: string, files: readonly string[]): string =>
  files.length === 0
    ? prompt
    : `${prompt}\nПриёмочные тесты ${task} уже в рабочем дереве, менять их нельзя: ${files.join(', ')}`;

const normalize = (text: string): string => text.replace(/\r\n/g, '\n').trimEnd();

/**
 * Сессия `$spec` в чистом дереве. Тесты остаются незакоммиченными: до кода они красные,
 * а импорты ещё не существующего кода не прошли бы хук pre-commit.
 * @returns шаг цикла при остановке или undefined — тесты записаны в state.spec.
 */
export async function writeSpec(
  context: LoopContext,
  task: string,
  remarks = '',
): Promise<Step | undefined> {
  const { git, state, config, definitions } = context;
  const base = await head(git);
  const result = await session(context, 'spec', specPrompt(task, remarks));
  if (result.failure !== undefined)
    return backoff(context, `$spec ${task}: ${result.failure}`, result.message);
  const paths = await changedPaths(git);
  const outside = paths.filter(
    (path) => !definitions.specPaths.some((glob) => globToRegExp(glob).test(path)),
  );
  if ((await head(git)) !== base || outside.length > 0)
    return park(
      context,
      `spec:${task}`,
      `$spec ${task} вышел за свои права (коммит или файлы вне тестов: ${outside.join(', ') || 'коммит'}) — проверь`,
      result.message,
    );
  const files: Record<string, string> = {};
  for (const path of paths) {
    const text = await readFile(join(config.root, path), 'utf8').catch(() => undefined);
    if (text === undefined)
      return park(
        context,
        `spec:${task}`,
        `$spec ${task} удалил ${path} — проверь`,
        result.message,
      );
    files[path] = text;
  }
  state.spec[task] = files;
  await save(context);
  await context.say(
    `приёмочные тесты ${task}: ${paths.join(', ') || 'нет (критерии не для тестов)'}`,
  );
  return undefined;
}

/** Перед работой: приёмочные тесты в дереве в записанном виде (после остановки их убирали). */
export async function placeSpec(context: LoopContext, task: string): Promise<void> {
  for (const [path, text] of Object.entries(context.state.spec[task] ?? {})) {
    const file = join(context.config.root, path);
    const current = await readFile(file, 'utf8').catch(() => undefined);
    if (current !== undefined && normalize(current) === normalize(text)) continue;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, 'utf8');
  }
}

/**
 * Исполнитель остановился (вопрос, задача владельца) и оставил в дереве только приёмочные
 * тесты: цикл возвращает файлы к HEAD, чтобы Issue владельца не ждали чистого дерева.
 * @returns true, если дерево стало чистым.
 */
export async function setSpecAside(context: LoopContext, task: string): Promise<boolean> {
  const { git, config } = context;
  const spec = context.state.spec[task];
  const paths = await changedPaths(git);
  if (spec === undefined || paths.length === 0 || paths.some((path) => !(path in spec)))
    return false;
  for (const path of paths) {
    const shown = await git.attempt(['show', `HEAD:${path}`]);
    if (shown.code === 0) await writeFile(join(config.root, path), shown.stdout, 'utf8');
    else await rm(join(config.root, path), { force: true });
  }
  return (await dirtyFiles(git)) === '';
}

/** @returns причина, если приёмочные тесты не закоммичены или изменены исполнителем. */
export async function specViolation(
  context: LoopContext,
  task: string,
): Promise<string | undefined> {
  for (const [path, text] of Object.entries(context.state.spec[task] ?? {})) {
    const shown = await context.git.attempt(['show', `HEAD:${path}`]);
    if (shown.code !== 0) return `приёмочный тест ${path} не закоммичен`;
    if (normalize(shown.stdout) !== normalize(text))
      return `исполнитель изменил приёмочный тест ${path}`;
  }
  return undefined;
}

/** Задача закрыта или тесты пишутся заново: записанные тесты больше не нужны. */
export async function forgetSpec(context: LoopContext, task: string): Promise<void> {
  if (!(task in context.state.spec)) return;
  context.state.spec = Object.fromEntries(
    Object.entries(context.state.spec).filter(([key]) => key !== task),
  );
  await save(context);
}
