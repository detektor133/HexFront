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
  readonly token?: string;
  readonly fetchFn?: FetchFn;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly writeLine?: (line: string) => void;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
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

const request = async (fetchFn: FetchFn, url: string, headers: Record<string, string>) => {
  const response = await fetchFn(url, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${url}`);
  return response;
};

const findFailedJob = (jobs: readonly WorkflowJob[]): WorkflowJob | undefined =>
  jobs.find((job) => job.conclusion === 'failure') ??
  jobs.find((job) => job.conclusion !== null && !SUCCESSFUL_JOB_CONCLUSIONS.has(job.conclusion));

const findRun = (runs: readonly WorkflowRun[], sha: string): WorkflowRun | undefined =>
  runs.find((run) => run.head_sha === sha && run.status === 'completed') ??
  runs.find((run) => run.head_sha === sha);

const printFailedRun = async (
  fetchFn: FetchFn,
  apiBase: string,
  headers: Record<string, string>,
  run: WorkflowRun,
  writeLine: (line: string) => void,
): Promise<number> => {
  const jobsResponse = await request(
    fetchFn,
    `${apiBase}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
    headers,
  );
  const jobsPayload = (await jobsResponse.json()) as WorkflowJobsPayload;
  const job = findFailedJob(jobsPayload.jobs ?? []);
  if (!job) {
    writeLine(`failure job=unknown ${run.html_url}`);
    return 1;
  }

  const logResponse = await request(fetchFn, `${apiBase}/actions/jobs/${job.id}/logs`, headers);
  const lines = (await logResponse.text()).replace(/\r\n/g, '\n').trimEnd().split('\n').slice(-30);
  for (const line of lines) writeLine(line);
  writeLine(`failure job=${job.name} ${run.html_url}`);
  return 1;
};

/** Ожидает GitHub Actions для SHA не дольше заданного таймаута, миллисекунды. */
export async function waitForCi(options: WaitForCiOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const writeLine = options.writeLine ?? console.log;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const apiBase = `https://api.github.com/repos/${options.repo}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hexfront-ci-wait',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const startedAt = now();
  let lastRun: WorkflowRun | undefined;
  while (true) {
    const response = await request(
      fetchFn,
      `${apiBase}/actions/runs?head_sha=${encodeURIComponent(options.sha)}&per_page=10`,
      headers,
    );
    const payload = (await response.json()) as WorkflowRunsPayload;
    lastRun = findRun(payload.workflow_runs ?? [], options.sha) ?? lastRun;

    if (lastRun?.status === 'completed') {
      if (lastRun.conclusion === 'success') {
        writeLine(`success ${lastRun.html_url}`);
        return 0;
      }
      return printFailedRun(fetchFn, apiBase, headers, lastRun, writeLine);
    }

    const elapsedMs = now() - startedAt;
    const pendingUrl =
      lastRun?.html_url ?? `${apiBase}/actions/runs?head_sha=${encodeURIComponent(options.sha)}`;
    writeLine(`pending ${pendingUrl} ${Math.floor(elapsedMs / 1000)}`);
    if (elapsedMs >= timeoutMs) {
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
