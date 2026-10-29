export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<HttpResponse>;

interface WorkflowRun {
  readonly id: number;
  readonly head_sha: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly html_url: string;
  readonly run_number?: number;
  readonly run_attempt?: number;
  readonly created_at?: string;
  /** Путь файла workflow, `.github/workflows/pages.yml`. */
  readonly path?: string;
}

interface WorkflowRunsPayload {
  readonly workflow_runs?: WorkflowRun[];
}

interface WorkflowJob {
  readonly id: number;
  readonly name: string;
  readonly conclusion: string | null;
}

interface WorkflowJobsPayload {
  readonly jobs?: WorkflowJob[];
}

export interface WaitForCiOptions {
  readonly repo: string;
  readonly sha: string;
  /** Файл workflow: `ci.yml` — быстрые проверки (по умолчанию), `slow.yml` — все тесты. */
  readonly workflow?: string;
  readonly token?: string;
  readonly fetchFn?: FetchFn;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly writeLine?: (line: string) => void;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  /** Один опрос без ожидания: незавершённый прогон — строка `pending` и код 3. */
  readonly once?: boolean;
  /** После перезапуска job игнорировать старую попытку того же workflow. */
  readonly afterAttempt?: number;
  /**
   * Зелёный CI требует и остальные workflow этого SHA, кроме `slow.yml` (флаг `--all-workflows`;
   * цикл — перед ревью и слиянием задачи). 2026-10-14: `pages.yml` 07/T4 падал на каждом push,
   * а цикл смотрел только `ci.yml`, и ревью приняло сломанную публикацию.
   */
  readonly otherWorkflows?: boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_WORKFLOW = 'ci.yml';
const SUCCESSFUL_JOB_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

/** @returns GitHub-репозиторий в формате owner/repo. */
export function parseGithubRepo(remote: string): string {
  const normalized = remote.trim().replace(/\.git$/, '');
  const match = normalized.match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/,
  );
  if (!match?.[1]) throw new Error(`неподдерживаемый GitHub remote: ${remote}`);
  return match[1];
}

const defaultFetch: FetchFn = async (url, init) => fetch(url, init);
const defaultSleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Запрос к GitHub не удался: это не результат CI. `transient` — сеть, 5xx или 429, стоит повторить. */
export class GithubRequestError extends Error {
  readonly transient: boolean;

  constructor(message: string, transient: boolean) {
    super(message);
    this.transient = transient;
  }
}

const request = async (fetchFn: FetchFn, url: string, headers: Record<string, string>) => {
  let response: HttpResponse;
  try {
    response = await fetchFn(url, { headers });
  } catch (error) {
    throw new GithubRequestError(`сеть: ${String(error)}`, true);
  }
  if (!response.ok)
    throw new GithubRequestError(
      `GitHub API ${response.status}: ${url}`,
      response.status >= 500 || response.status === 429,
    );
  return response;
};

/** Сбой одного опроса: временный пишется в строку ожидания, постоянный (401, 403, 404) — сразу наружу. */
const transientMessage = (error: unknown): string => {
  if (error instanceof GithubRequestError && !error.transient) throw error;
  return error instanceof Error ? error.message : String(error);
};

const findFailedJob = (jobs: readonly WorkflowJob[]): WorkflowJob | undefined =>
  jobs.find((job) => job.conclusion === 'failure') ??
  jobs.find((job) => job.conclusion !== null && !SUCCESSFUL_JOB_CONCLUSIONS.has(job.conclusion));

/** Workflow, который цикл ждёт отдельно и не дожидается в CI задачи: все тесты идут долго. */
const SEPARATE_WORKFLOWS = ['slow.yml'];
/** Workflow, без которых `--all-workflows` не может объявить push зелёным. */
const REQUIRED_WORKFLOWS = ['pages.yml'];
/** Отменённый прогон — не поломка: его заменил прогон нового push или его отменил человек. */
const IGNORED_CONCLUSIONS = new Set(['cancelled']);

const runOrder = (run: WorkflowRun): readonly [number, number, number] => [
  run.run_number ?? 0,
  run.run_attempt ?? 0,
  run.id,
];

const newerRun = (left: WorkflowRun, right: WorkflowRun): number => {
  const a = runOrder(left);
  const b = runOrder(right);
  return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
};

/** Последние прогоны остальных workflow SHA: по одному на файл, без основного и отдельных. */
const otherRuns = (runs: readonly WorkflowRun[], main: WorkflowRun): WorkflowRun[] => {
  const seen = new Set<string>();
  return [...runs].sort(newerRun).filter((run) => {
    const path = run.path ?? String(run.id);
    if (run.id === main.id || run.path === main.path || seen.has(path)) return false;
    seen.add(path);
    return !SEPARATE_WORKFLOWS.some((name) => path.endsWith(`/${name}`));
  });
};

const findRun = (runs: readonly WorkflowRun[], sha: string): WorkflowRun | undefined =>
  [...runs].filter((run) => run.head_sha === sha).sort(newerRun)[0];

const printFailedRun = async (
  fetchFn: FetchFn,
  apiBase: string,
  headers: Record<string, string>,
  run: WorkflowRun,
  writeLine: (line: string) => void,
): Promise<number> => {
  // Run уже красный: сбой при чтении job или лога не должен превращать его в «не проверено».
  let job: WorkflowJob | undefined;
  try {
    const jobsResponse = await request(
      fetchFn,
      `${apiBase}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
      headers,
    );
    job = findFailedJob(((await jobsResponse.json()) as WorkflowJobsPayload).jobs ?? []);
    if (job) {
      const logResponse = await request(fetchFn, `${apiBase}/actions/jobs/${job.id}/logs`, headers);
      const text = await logResponse.text();
      for (const line of text.replace(/\r\n/g, '\n').trimEnd().split('\n').slice(-30))
        writeLine(line);
    }
  } catch (error) {
    writeLine(
      `лог упавшего job не получен: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // Прогон без job — сам файл workflow не принят GitHub: называем файл, а не «unknown».
  writeLine(`run_attempt=${run.run_attempt ?? 1}`);
  writeLine(`failure job=${job?.name ?? run.path?.split('/').pop() ?? 'unknown'} ${run.html_url}`);
  return 1;
};

/**
 * Ожидает GitHub Actions для SHA не дольше заданного таймаута, миллисекунды.
 * @returns 0 — CI зелёный, 1 — CI красный или не дождались, 2 — GitHub недоступен (CI не проверен),
 *   3 — при `once` прогон ещё идёт или не создан.
 */
export async function waitForCi(options: WaitForCiOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const writeLine = options.writeLine ?? console.log;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const apiBase = `https://api.github.com/repos/${options.repo}`;
  // Прогоны только своего workflow: иначе ожидание быстрого CI взяло бы прогон `slow`.
  const query = `head_sha=${encodeURIComponent(options.sha)}&event=push`;
  const runsUrl = `${apiBase}/actions/workflows/${options.workflow ?? DEFAULT_WORKFLOW}/runs?${query}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hexfront-ci-wait',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const allRunsUrl = `${apiBase}/actions/runs?${query}`;
  const checkOthers = options.otherWorkflows === true;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const startedAt = now();
  let lastRun: WorkflowRun | undefined;
  while (true) {
    let lastError: string | undefined;
    try {
      const response = await request(fetchFn, `${runsUrl}&per_page=10`, headers);
      const payload = (await response.json()) as WorkflowRunsPayload;
      lastRun =
        findRun(
          (payload.workflow_runs ?? []).filter(
            (run) => (run.run_attempt ?? 1) > (options.afterAttempt ?? 0),
          ),
          options.sha,
        ) ?? lastRun;
    } catch (error) {
      lastError = transientMessage(error);
    }

    let pendingOther: WorkflowRun | undefined;
    if (lastRun?.status === 'completed') {
      if (lastRun.conclusion !== 'success')
        return printFailedRun(fetchFn, apiBase, headers, lastRun, writeLine);
      if (!checkOthers) {
        writeLine(`success ${lastRun.html_url}`);
        return 0;
      }
      try {
        const response = await request(fetchFn, `${allRunsUrl}&per_page=50`, headers);
        const others = otherRuns(
          ((await response.json()) as WorkflowRunsPayload).workflow_runs ?? [],
          lastRun,
        );
        const failed = others.find(
          (run) =>
            run.status === 'completed' &&
            run.conclusion !== null &&
            !SUCCESSFUL_JOB_CONCLUSIONS.has(run.conclusion) &&
            !IGNORED_CONCLUSIONS.has(run.conclusion),
        );
        if (failed) return printFailedRun(fetchFn, apiBase, headers, failed, writeLine);
        pendingOther = others.find((run) => run.status !== 'completed');
        const missingRequired = REQUIRED_WORKFLOWS.filter(
          (name) =>
            !others.some(
              (run) =>
                run.path?.endsWith(`/${name}`) &&
                run.status === 'completed' &&
                run.conclusion === 'success',
            ),
        );
        if (pendingOther === undefined && missingRequired.length === 0) {
          writeLine(`success ${lastRun.html_url}`);
          return 0;
        }
      } catch (error) {
        lastError = transientMessage(error);
      }
    }

    const elapsedMs = now() - startedAt;
    const pendingUrl = pendingOther?.html_url ?? lastRun?.html_url ?? runsUrl;
    const error = lastError === undefined ? '' : ` error=${lastError}`;
    writeLine(`pending ${pendingUrl} ${Math.floor(elapsedMs / 1000)}${error}`);
    if (options.once === true) {
      if (lastError === undefined) return 3;
      writeLine(`error ${lastError}`);
      return 2;
    }
    if (elapsedMs >= timeoutMs) {
      if (lastError !== undefined) {
        writeLine(`error ${lastError}`);
        return 2;
      }
      writeLine(
        lastRun
          ? `failure timeout ${lastRun.html_url}`
          : `failure run=not-found sha=${options.sha}`,
      );
      return 1;
    }
    await sleep(pollIntervalMs);
  }
}
