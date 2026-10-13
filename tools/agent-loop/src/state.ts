// Память цикла между запусками: `.ai-logs/agent-loop/state.json`, вне git, только на этом ПК.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface LoopState {
  /** Недоделка: сессия этой задачи оборвалась с незакоммиченной работой. */
  resume?: string;
  /** Ожидание: та же причина при том же HEAD повторно сессий не запускает. */
  parked?: { readonly key: string; readonly head: string; readonly reason: string };
  /** До этого времени (мс) codex не запускается: сбой или кончился лимит. */
  retryAfter?: number;
  /** Задачи, уже разбитые `$split`: повторная просьба разбить — к владельцу. */
  split: string[];
  /** Число сбоев codex по Issue; второй сбой ставит `agent-stop`. */
  issueFailures: Record<string, number>;
  /** Issues, на которые цикл уже ответил: не исполняются повторно, даже если GitHub не принял закрытие или метку. */
  answeredIssues: number[];
  /**
   * Только что исполненные Issues: `updated_at` на момент взятия и время ответа, мс. Список Issues
   * GitHub отстаёт на секунды и ещё показывает закрытую Issue открытой — её нельзя взять снова.
   */
  recentIssues: Record<string, { readonly updatedAt: string; readonly at: number }>;
  /** HEAD, для которого цикл сам видел зелёный CI: ревью этого HEAD CI не ждёт. */
  greenHead?: string;
  /** HEAD, для которого цикл видел зелёный workflow `slow` (все тесты). */
  slowGreen?: string;
  /** Задачи, которые уже чинили по красному `slow`: второй красный — к владельцу. */
  slowFixes: string[];
  /** Приёмочные тесты `$spec` по задаче: путь → содержимое; исполнитель коммитит их без изменений. */
  spec: Record<string, Record<string, string>>;
  /** PR закрытого этапа по ветке. */
  pullRequests: Record<string, string>;
}

export const statePath = (root: string): string =>
  join(root, '.ai-logs', 'agent-loop', 'state.json');

export async function loadState(root: string): Promise<LoopState> {
  const empty: LoopState = {
    split: [],
    issueFailures: {},
    answeredIssues: [],
    recentIssues: {},
    slowFixes: [],
    spec: {},
    pullRequests: {},
  };
  const text = await readFile(statePath(root), 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  return text === '' ? empty : { ...empty, ...(JSON.parse(text) as Partial<LoopState>) };
}

export async function saveState(root: string, state: LoopState): Promise<void> {
  const path = statePath(root);
  await mkdir(dirname(path), { recursive: true });
  // Через временный файл: оборванная запись не должна ломать каждый следующий запуск.
  await writeFile(`${path}.tmp`, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(`${path}.tmp`, path);
}
