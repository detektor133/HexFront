// Сторож чужого масштаба: обычная задача (не `NN/infra`) не меняет сам контрольный код цикла.
// 2026-10-17, 07/T22: задача про красный CI клиентских тестов сама правила
// `tools/agent-loop/src/tasks.ts`, чтобы обойти собственную остановку на двух ожидающих ревью.
// Ревью это заметило, но только как недостаточное закрытие критерия, не как нарушение масштаба.
import { globToRegExp } from './context.ts';
import type { Git } from './git.ts';

/** Пути из `git diff --name-status`; при переименовании учитываются старый и новый. */
const touchedPaths = (nameStatus: string): string[] =>
  nameStatus
    .split(/\r?\n/u)
    .flatMap((line) => line.split('\t').slice(1))
    .filter(Boolean);

/** Пути, которые обычная задача трогать не должна: это код и настройка самого цикла. */
const FORBIDDEN_GLOBS = ['tools/agent-loop/**', '.codex/**', 'tools/agent-loop/permissions.json'];
const forbiddenMatchers = FORBIDDEN_GLOBS.map((glob) => globToRegExp(glob));

/** Запретные незакоммиченные пути, появившиеся в рабочей сессии обычной задачи. */
export const forbiddenWorkingPaths = (paths: readonly string[]): string[] =>
  paths.filter((path) => forbiddenMatchers.some((re) => re.test(path)));

/** Задача из файла этапа (`NN/Tn`) против служебной (`NN/infra`), которой это разрешено. */
export const isInfraTask = (task: string): boolean => task.endsWith('/infra');

/** Пути коммитов задачи после `base`, попавшие под запрет; пусто — нарушения нет. */
export async function forbiddenPaths(git: Git, base: string): Promise<string[]> {
  const nameStatus = await git.run(['diff', '--name-status', `${base}..HEAD`]);
  const touched = touchedPaths(nameStatus);
  const forbidden = forbiddenWorkingPaths(touched);
  const taskOwned: string[] = [];
  for (const path of forbidden) {
    const messages = (await git.run(['log', '--format=%B%x00', `${base}..HEAD`, '--', path]))
      .split('\0')
      .map((message) => message.trim())
      .filter(Boolean);
    if (
      messages.length === 0 ||
      messages.some((message) => !/^Этап:\s*\d{2}\/infra\s*$/mu.test(message))
    )
      taskOwned.push(path);
  }
  return taskOwned;
}

/** Запрос ожидания владельца: задача изменила код цикла без поручения. */
export const scopeViolation = (task: string, paths: readonly string[]): string =>
  `${task} изменила код цикла (${paths.join(', ')}) без поручения владельца — это не входит в задачу; ` +
  `нужна Issue владельца, явно разрешающая эту правку, или откат этих файлов отдельным коммитом`;
