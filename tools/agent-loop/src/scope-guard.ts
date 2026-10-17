// Сторож чужого масштаба: обычная задача (не `NN/infra`) не меняет сам контрольный код цикла.
// 2026-10-17, 07/T22: задача про красный CI клиентских тестов сама правила
// `tools/agent-loop/src/tasks.ts`, чтобы обойти собственную остановку на двух ожидающих ревью.
// Ревью это заметило, но только как недостаточное закрытие критерия, не как нарушение масштаба.
import { globToRegExp } from './context.ts';
import type { Git } from './git.ts';
import { touchedPaths } from './return-guard.ts';

/** Пути, которые обычная задача трогать не должна: это код и настройка самого цикла. */
const FORBIDDEN_GLOBS = ['tools/agent-loop/**', '.codex/**', 'tools/agent-loop/permissions.json'];

/** Задача из файла этапа (`NN/Tn`) против служебной (`NN/infra`), которой это разрешено. */
export const isInfraTask = (task: string): boolean => task.endsWith('/infra');

/** Пути коммитов задачи после `base`, попавшие под запрет; пусто — нарушения нет. */
export async function forbiddenPaths(git: Git, base: string): Promise<string[]> {
  const nameStatus = await git.run(['diff', '--name-status', `${base}..HEAD`]);
  const touched = touchedPaths(nameStatus);
  const globs = FORBIDDEN_GLOBS.map((glob) => globToRegExp(glob));
  return touched.filter((path) => globs.some((re) => re.test(path)));
}

/** Запрос ожидания владельца: задача изменила код цикла без поручения. */
export const scopeViolation = (task: string, paths: readonly string[]): string =>
  `${task} изменила код цикла (${paths.join(', ')}) без поручения владельца — это не входит в задачу; ` +
  `нужна Issue владельца, явно разрешающая эту правку, или откат этих файлов отдельным коммитом`;
