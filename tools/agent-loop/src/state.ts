// Память цикла между запусками: `.ai-logs/agent-loop/state.json`, вне git, только на этом ПК.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Больше потоков не даёт выигрыша: упор в общие файлы, зависимости задач и лимит codex. */
export const MAX_STREAMS = 4;

export interface LoopState {
  /** Сколько задач может идти одновременно (Issue `$streams N` или `--streams N`); нет — 1. */
  streams?: number;
  /** Недоделка: сессия этой задачи оборвалась с незакоммиченной работой. */
  resume?: string;
  /**
   * Незакоммиченная работа задачи ждёт ответа владельца (вопрос исполнителя): ответ — Issue
   * `$decide` или `$bug`, на время которой работа откладывается (shelve.ts), потом продолжается.
   */
  waitingAnswer?: { readonly task: string; readonly reason: string };
  /** Работа этой задачи лежит в git stash на время Issue владельца. */
  shelved?: string;
  /** Строка для следующей сессии `продолжить`: что изменилось, пока работа ждала. */
  resumeNote?: string;
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
  /** HEAD, на котором цикл уже перезапускал красный `slow`: второй раз не перезапускает. */
  slowRerun?: string;
  /** HEAD, на котором цикл записал красный `slow` багом через `$bug`; снимается зелёным. */
  slowBug?: string;
  /** Ручной `$spec`: снимки тестов. Автоматическая очередь это поле не читает. */
  spec: Record<string, Record<string, string>>;
  /** Совместимость ручного `$spec` с его прежними незавершёнными запусками. */
  specUnlocked: Record<string, string[]>;
  /** Совместимость ручного `$spec` с его прежними незавершёнными запусками. */
  specRepairNotes: Record<string, string[]>;
  /** PR закрытого этапа по ветке. */
  pullRequests: Record<string, string>;
  /**
   * Коммит последнего ВОЗВРАТ ревью по задаче: от него повторное ревью видит изменённые строки
   * (review-scope.ts). Живёт до `[x]` задачи.
   */
  reviewReturns: Record<string, string>;
  /**
   * Дословный последний ВОЗВРАТ ревью по задаче. Следующая сессия исполнителя получает его
   * напрямую; файл этапа остаётся историей, но больше не служит единственным каналом передачи.
   * Живёт до `[x]` задачи.
   */
  reviewFeedback: Record<string, string>;
  /**
   * Сколько раз ревью вернуло задачу за все запуски цикла: лимит кругов считается на запуск, а это
   * число показывает владельцу, сколько возвратов уже было. Живёт до `[x]` задачи.
   */
  returnTotals: Record<string, number>;
  /**
   * Задачи, которые `plan` заблокировал вопросом в `docs/QUESTIONS.md`, по задаче — снимок её
   * блока на момент блокировки. Пока блок не изменился, цикл не зовёт `plan` снова и выбирает
   * следующую незаблокированную задачу очереди; изменённый блок (ответ владельца) снимает блок.
   */
  planBlocked: Record<string, string>;
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
    specUnlocked: {},
    specRepairNotes: {},
    pullRequests: {},
    reviewReturns: {},
    reviewFeedback: {},
    returnTotals: {},
    planBlocked: {},
  };
  const text = await readFile(statePath(root), 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  if (text === '') return empty;
  const saved = JSON.parse(text) as Partial<LoopState>;
  // Старый `specRewrite` больше не даёт исполнителю править тесты: его не мигрируем.
  const { specRewrite, ...current } = saved as Partial<LoopState> & {
    readonly specRewrite?: unknown;
  };
  void specRewrite;
  return { ...empty, ...current };
}

export async function saveState(root: string, state: LoopState): Promise<void> {
  const path = statePath(root);
  await mkdir(dirname(path), { recursive: true });
  // Через временный файл: оборванная запись не должна ломать каждый следующий запуск.
  await writeFile(`${path}.tmp`, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(`${path}.tmp`, path);
}
