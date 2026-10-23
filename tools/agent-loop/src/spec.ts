// Приёмочные тесты до кода: сессия `$spec` (роль spec) пишет по тексту задачи только тесты,
// цикл запоминает их содержимое, исполнитель коммитит их вместе с кодом и менять не может.
// Возврат ревью о тестах исправляет отдельная сессия `$spec`, которая видит один пункт.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  backoff,
  globToRegExp,
  lastLines,
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
  remarks === '' ? `$spec ${task}` : `$spec ${task}\nЗамечания к приёмочным тестам:\n${remarks}`;

/**
 * Промпт работы с приёмочными тестами: исполнитель знает, что они уже в дереве и закрыты, и как
 * сообщить о неверном тесте. 2026-10-15, 07/T14: тест зависел от локали CI, исполнитель дважды
 * подгонял под него код вместо замечания `СПЕК:`, по которому тест чинит `$spec`.
 */
export const withSpec = (prompt: string, task: string, files: readonly string[]): string =>
  files.length === 0
    ? prompt
    : `${prompt}\nПриёмочные тесты ${task} уже в рабочем дереве, менять их нельзя: ${files.join(', ')}. Если закрытый тест сам неверен (зависит от окружения, локали или порядка файлов, проверяет не тот путь, противоречит тексту задачи) — код под него не подгоняй: ничего не коммить и ответь строкой «СПЕК: <файл>:<строки> — что не так», тест исправит $spec.`;

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

/** Строка коммита владельца: приёмочный тест исправлен им, цикл берёт версию из HEAD. */
export const SPEC_UPDATE_LINE = 'Приёмочный тест обновлён:';
/** Сколько последних коммитов цикл просматривает в поисках строки владельца. */
const SPEC_UPDATE_WINDOW = 30;

/**
 * Приёмочные тесты, исправленные коммитом владельца (строка «Приёмочный тест обновлён: <путь>»),
 * цикл берёт из HEAD вместо записанных. 2026-10-15, 07/T14: тест исправили вне цикла, а цикл
 * вернул бы старую копию и встал на «исполнитель изменил приёмочный тест». Вызывается только до
 * сессии исполнителя: его правка теста в своей сессии по-прежнему нарушение (`specViolation`).
 */
export async function adoptOwnerSpec(context: LoopContext, task: string): Promise<void> {
  const saved = context.state.spec[task];
  if (saved === undefined) return;
  let log: string | undefined;
  const updated: Record<string, string> = { ...saved };
  let changed = false;
  for (const [path, text] of Object.entries(saved)) {
    const shown = await context.git.attempt(['show', `HEAD:${path}`]);
    if (shown.code !== 0 || normalize(shown.stdout) === normalize(text)) continue;
    log ??= (await context.git.attempt(['log', `-${SPEC_UPDATE_WINDOW}`, '--format=%B'])).stdout;
    const marked = log
      .split(/\r?\n/u)
      .some((line) => line.trim() === `${SPEC_UPDATE_LINE} ${path}`);
    if (!marked) continue;
    updated[path] = shown.stdout;
    changed = true;
    await context.say(`приёмочный тест ${path} обновлён владельцем — цикл берёт версию из HEAD`);
  }
  if (!changed) return;
  context.state.spec = { ...context.state.spec, [task]: updated };
  await save(context);
}

/** Перед работой: приёмочные тесты в дереве в записанном виде (после остановки их убирали). */
export async function placeSpec(context: LoopContext, task: string): Promise<void> {
  await adoptOwnerSpec(context, task);
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
  const spec = context.state.spec[task];
  if (spec === undefined) return undefined;
  const orphaned = new Set<string>();
  for (const [path, text] of Object.entries(spec)) {
    const shown = await context.git.attempt(['show', `HEAD:${path}`]);
    if (shown.code !== 0) {
      // Ни в HEAD, ни на диске: осиротевшая запись (путь переименован в более раннем раунде
      // repair-$spec без удаления старого ключа — снимок `changedPathsBetween` видит только
      // добавленный новый путь, старый никогда не был закоммичен и не попадает в диапазон).
      // Терять нечего — убираем из учёта вместо вечного «не закоммичен» на призрак.
      const onDisk = await readFile(join(context.config.root, path), 'utf8').catch(() => undefined);
      if (onDisk === undefined) {
        orphaned.add(path);
        continue;
      }
      return `приёмочный тест ${path} не закоммичен`;
    }
    if (normalize(shown.stdout) !== normalize(text))
      return `исполнитель изменил приёмочный тест ${path}`;
  }
  if (orphaned.size > 0) {
    const kept = Object.fromEntries(Object.entries(spec).filter(([path]) => !orphaned.has(path)));
    context.state.spec = { ...context.state.spec, [task]: kept };
    await save(context);
  }
  return undefined;
}

/** Задача закрыта или тесты пишутся заново: записанные тесты больше не нужны. */
export async function forgetSpec(context: LoopContext, task: string): Promise<void> {
  const { state } = context;
  if (!(task in state.spec) && !(task in state.specRepairNotes) && !(task in state.specUnlocked))
    return;
  const other = ([key]: [string, unknown]): boolean => key !== task;
  state.spec = Object.fromEntries(Object.entries(state.spec).filter(other));
  state.specRepairNotes = Object.fromEntries(Object.entries(state.specRepairNotes).filter(other));
  state.specUnlocked = Object.fromEntries(Object.entries(state.specUnlocked).filter(other));
  await save(context);
}

/**
 * Перед работой над задачей очереди: приёмочные тесты `$spec` написаны (один раз на задачу)
 * и лежат в дереве. Доделка новых тестов не пишет.
 * @returns шаг цикла при остановке или undefined.
 */
export async function prepareSpec(
  context: LoopContext,
  task: string,
  fresh: boolean,
): Promise<Step | undefined> {
  if (!specEnabled(context)) return undefined;
  const { state } = context;
  // Сохранённые тесты не переписываются до отдельного возврата `ТЕСТ:`.
  if (fresh && !(task in state.spec) && !(task in state.specUnlocked)) {
    const stop = await writeSpec(context, task);
    if (stop !== undefined) return stop;
  }
  await placeSpec(context, task);
  return undefined;
}
