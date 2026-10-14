// Приёмочные тесты до кода: сессия `$spec` (роль spec) пишет по тексту задачи только тесты,
// цикл запоминает их содержимое, исполнитель коммитит их вместе с кодом и менять не может.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  backoff,
  globToRegExp,
  lastLines,
  park,
  readStage,
  save,
  session,
  type LoopContext,
  type Step,
} from './context.ts';
import { changedPaths, dirtyFiles, head } from './git.ts';
import { taskBlock } from './stage-file.ts';

/** Без роли spec в roles.json цикл работает по-старому: `$next` сам пишет тесты задачи. */
export const specEnabled = (context: LoopContext): boolean =>
  context.definitions.roles.spec !== undefined;

/** Пути приёмочных тестов задачи; пустой список — у задачи нет проверяемых тестами критериев. */
export const specFiles = (context: LoopContext, task: string): readonly string[] =>
  Object.keys(context.state.spec[task] ?? {});

export const specPrompt = (task: string, remarks: string): string =>
  remarks === '' ? `$spec ${task}` : `$spec ${task}\nЗамечания к приёмочным тестам:\n${remarks}`;

/** Промпт работы с приёмочными тестами: исполнитель знает, что они уже в дереве и закрыты. */
export const withSpec = (prompt: string, task: string, files: readonly string[]): string =>
  files.length === 0
    ? prompt
    : `${prompt}\nПриёмочные тесты ${task} уже в рабочем дереве, менять их нельзя: ${files.join(', ')}`;

const normalize = (text: string): string => text.replace(/\r\n/g, '\n').trimEnd();

/** Сколько раз $spec переписывает тесты, которые не проходят lint, прежде чем звать владельца. */
const LINT_ATTEMPTS = 2;
/** Предел одного прогона eslint или prettier по тестам, мс. */
const LINT_TIMEOUT_MS = 5 * 60_000;

type Tree = ReadonlyMap<string, string | undefined>;

/** Незакоммиченные файлы и их текст: в дереве может уже лежать работа исполнителя. */
async function treeSnapshot(context: LoopContext): Promise<Tree> {
  const tree = new Map<string, string | undefined>();
  for (const path of await changedPaths(context.git))
    tree.set(path, await readFile(join(context.config.root, path), 'utf8').catch(() => undefined));
  return tree;
}

/**
 * Одна сессия `$spec`. Сессия меняет только тесты: работу исполнителя в дереве (тесты чинятся по
 * его замечанию) она не трогает.
 * @returns тексты приёмочных тестов или шаг цикла при остановке.
 */
async function specSession(
  context: LoopContext,
  task: string,
  remarks: string,
): Promise<{ readonly files: Record<string, string> } | { readonly step: Step }> {
  const { git, state, config, definitions } = context;
  const base = await head(git);
  const before = await treeSnapshot(context);
  const result = await session(context, 'spec', specPrompt(task, remarks));
  if (result.failure !== undefined)
    return { step: await backoff(context, `$spec ${task}: ${result.failure}`, result.message) };
  const after = await treeSnapshot(context);
  const touched = [...new Set([...before.keys(), ...after.keys()])].filter(
    (path) => before.get(path) !== after.get(path) || before.has(path) !== after.has(path),
  );
  const outside = touched.filter(
    (path) => !definitions.specPaths.some((glob) => globToRegExp(glob).test(path)),
  );
  if ((await head(git)) !== base || outside.length > 0)
    return {
      step: await park(
        context,
        `spec:${task}`,
        `$spec ${task} вышел за свои права (коммит или файлы вне тестов: ${outside.join(', ') || 'коммит'}) — проверь`,
        result.message,
      ),
    };
  const files: Record<string, string> = {};
  for (const path of new Set([...Object.keys(state.spec[task] ?? {}), ...touched])) {
    const text = await readFile(join(config.root, path), 'utf8').catch(() => undefined);
    if (text === undefined)
      return {
        step: await park(
          context,
          `spec:${task}`,
          `$spec ${task} удалил ${path} — проверь`,
          result.message,
        ),
      };
    files[path] = text;
  }
  return { files };
}

/**
 * Порядок импортов и формат цикл чинит сам (смысл проверок не меняется); остальные ошибки lint
 * возвращаются сессии `$spec`: исполнитель тесты менять не может, и сломанный тест его остановил бы.
 * @returns вывод eslint или undefined, если тесты чистые.
 */
async function tidySpec(
  context: LoopContext,
  paths: readonly string[],
): Promise<string | undefined> {
  if (paths.length === 0) return undefined;
  const { runCommand, root } = context.config;
  const options = { cwd: root, timeoutMs: LINT_TIMEOUT_MS };
  const lint = await runCommand('pnpm', ['exec', 'eslint', '--fix', ...paths], options);
  await runCommand('pnpm', ['exec', 'prettier', '--write', ...paths], options);
  if (lint.code === 0) return undefined;
  return lastLines(`${lint.stdout}\n${lint.stderr}`.trim(), 30);
}

/**
 * Сессия `$spec`: по тексту задачи в чистом дереве или по замечаниям ревью и исполнителя.
 * Тесты остаются незакоммиченными: до кода они красные, а импорты ещё не существующего кода
 * не прошли бы хук pre-commit.
 * @returns шаг цикла при остановке или undefined — тесты записаны в state.spec.
 */
export async function writeSpec(
  context: LoopContext,
  task: string,
  remarks = '',
): Promise<Step | undefined> {
  const { state, config } = context;
  let note = remarks;
  for (let attempt = 1; ; attempt += 1) {
    const written = await specSession(context, task, note);
    if ('step' in written) return written.step;
    const paths = Object.keys(written.files);
    const errors = await tidySpec(context, paths);
    const files: Record<string, string> = {};
    for (const path of paths) files[path] = await readFile(join(config.root, path), 'utf8');
    state.spec[task] = files;
    await save(context);
    if (errors === undefined) {
      await context.say(
        `приёмочные тесты ${task}: ${paths.join(', ') || 'нет (критерии не для тестов)'}`,
      );
      return undefined;
    }
    if (attempt >= LINT_ATTEMPTS)
      return park(context, `spec:${task}`, `приёмочные тесты ${task} не проходят lint`, errors);
    await context.say(`приёмочные тесты ${task} не проходят lint — $spec исправляет`);
    note = `lint тестов (порядок импортов и формат цикл уже поправил):\n${errors}`;
  }
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
  const { state } = context;
  if (!(task in state.spec) && !(task in state.specRepairNotes)) return;
  const other = ([key]: [string, unknown]): boolean => key !== task;
  state.spec = Object.fromEntries(Object.entries(state.spec).filter(other));
  state.specRepairNotes = Object.fromEntries(Object.entries(state.specRepairNotes).filter(other));
  await save(context);
}

/** Замечание к приёмочным тестам: строка `СПЕК: …` в ответе `ВОЗВРАТ` ревью или исполнителя. */
export const SPEC_REMARK_RE = /^\s*[-*]?\s*СПЕК:/imu;

/** Текст ссылается на файл приёмочного теста (путь или имя файла). */
export const mentionsSpec = (text: string, files: readonly string[]): boolean =>
  files.some((path) => text.includes(path) || text.includes(path.split('/').at(-1) ?? path));

/** Строки возврата ревью в блоке задачи, которые говорят о приёмочных тестах. */
export const returnedForSpec = (block: string, files: readonly string[]): string =>
  block
    .split(/\r?\n/)
    .filter((line) => /возврат/iu.test(line) && mentionsSpec(line, files))
    .join('\n');

/** Строки `СПЕК: …` ответа: замечания к приёмочным тестам. */
export const specRemarks = (message: string): string =>
  message
    .split(/\r?\n/)
    .filter((line) => SPEC_REMARK_RE.test(line))
    .join('\n');

/**
 * Перед работой над задачей очереди: приёмочные тесты `$spec` написаны (один раз на задачу
 * или заново после замечаний ревью) и лежат в дереве. Доделка новых тестов не пишет.
 * @returns шаг цикла при остановке или undefined.
 */
export async function prepareSpec(
  context: LoopContext,
  task: string,
  fresh: boolean,
  remarks: string,
): Promise<Step | undefined> {
  if (!specEnabled(context)) return undefined;
  if (fresh && !(task in context.state.spec)) {
    const stop = await writeSpec(context, task, remarks);
    if (stop !== undefined) return stop;
  }
  await placeSpec(context, task);
  return undefined;
}

/**
 * Возврат ревью в блоке задачи о приёмочных тестах, который ещё не уходил в `$spec`: замечания
 * для новых тестов. Ответ ревью может не назвать файл, а замечание прошлого запуска цикла
 * в памяти не живёт. 2026-10-14, 07/T1: после перезапуска исполнитель не мог выполнить возврат
 * со старым тестом и взял 07/T2.
 */
export async function pendingSpecReturn(context: LoopContext, task: string): Promise<string> {
  const files = specFiles(context, task);
  if (files.length === 0) return '';
  const { stageText } = await readStage(context.config.root);
  const returned = returnedForSpec(taskBlock(stageText, task), files).trim();
  if (returned === '' || (context.state.specRepairNotes[task] ?? []).includes(returned)) return '';
  await forgetSpec(context, task);
  context.state.specRepairNotes = { ...context.state.specRepairNotes, [task]: [returned] };
  await save(context);
  await context.say(`возврат ревью ${task} о приёмочных тестах — их переписывает $spec`);
  return returned;
}
