// Issues как конверт команды владельца и PR закрытого этапа: REST API GitHub через fetch.
import { commandTask } from './stage-file.ts';
import { MAX_STREAMS } from './state.ts';

export interface AgentIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly labels: readonly string[];
  /** `updated_at` GitHub: меняется с каждой правкой, меткой, комментарием. */
  readonly updatedAt: string;
}
export interface GithubClient {
  /** owner/repo. */
  readonly repo: string;
  /** Владелец репозитория: цикл исполняет только его Issues. */
  readonly owner: string;
  readonly listIssues: () => Promise<readonly AgentIssue[]>;
  /**
   * Issue по номеру, прямым запросом: список Issues GitHub отстаёт на секунды (Issue уже
   * закрыта, а список отдаёт её открытой, с новым `updated_at` от ответа цикла), запрос по
   * номеру — нет. @returns undefined, если Issue закрыта.
   */
  readonly openIssue: (issue: number) => Promise<AgentIssue | undefined>;
  readonly comment: (issue: number, body: string) => Promise<void>;
  readonly close: (issue: number) => Promise<void>;
  readonly addLabel: (issue: number, label: string) => Promise<void>;
  /** @returns адрес открытого PR head → base, нового или уже существующего. */
  readonly openPullRequest: (head: string, base: string, title: string) => Promise<string>;
  /**
   * Дешёвая проверка между шагами: изменились ли Issues с меткой `agent` или `main`
   * (мерж PR этапа) с прошлого вызова. Первый вызов только запоминает состояние.
   */
  readonly changed: () => Promise<boolean>;
}

export const AGENT_LABEL = 'agent';
export const STOP_LABEL = 'agent-stop';

/** Как команда читает аргумент: номер задачи, текст владельца или ничего. */
const SKILLS = {
  decide: 'text',
  bug: 'text',
  split: 'task',
  task: 'task',
  accept: 'task',
  review: 'task',
  done: 'task',
  'stage-close': 'none',
  // Не скилл codex: настройку исполняет сам цикл.
  streams: 'count',
} as const;
export type Skill = keyof typeof SKILLS;
export interface IssueCommand {
  readonly skill: Skill;
  readonly task?: string;
  /** `$streams N`: предел одновременных задач. */
  readonly count?: number;
  /** Тело Issue дословно: первая строка — команда, дальше текст владельца. */
  readonly prompt: string;
}

const isSkill = (name: string): name is Skill => Object.hasOwn(SKILLS, name);

/** @returns команда из первой строки тела Issue или причина, почему её нельзя выполнить. */
export function parseIssueCommand(body: string): IssueCommand | { readonly error: string } {
  const prompt = body.replace(/\r\n/g, '\n').trim();
  const first = prompt.split('\n', 1)[0] ?? '';
  const name = first.match(/^\$([a-z-]+)(?=\s|$)/)?.[1] ?? '';
  if (!isSkill(name))
    return {
      error: `первая строка тела должна быть командой: ${Object.keys(SKILLS)
        .map((skill) => `$${skill}`)
        .join(', ')}`,
    };
  const kind = SKILLS[name];
  const task = commandTask(first, `$${name}`);
  if (kind === 'task' && task === undefined)
    return { error: `после $${name} нужен номер задачи, например $${name} 06/T2` };
  if (kind === 'count') {
    const count = Number(first.slice(name.length + 1).trim());
    return Number.isInteger(count) && count >= 1 && count <= MAX_STREAMS
      ? { skill: name, count, prompt }
      : { error: `после $${name} нужно число задач одновременно от 1 до ${MAX_STREAMS}` };
  }
  if (kind === 'text' && prompt.slice(name.length + 1).trim() === '')
    return { error: `после $${name} нужен текст владельца` };
  return kind === 'task' && task !== undefined
    ? { skill: name, task, prompt }
    : { skill: name, prompt };
}

/** @returns owner/repo из адреса origin. */
export function parseGithubRepo(remote: string): string {
  const match = remote
    .trim()
    .replace(/\.git$/, '')
    .match(/github\.com[/:]([^/]+\/[^/]+)$/);
  if (!match?.[1]) throw new Error(`origin не на GitHub: ${remote}`);
  return match[1];
}

interface IssuePayload {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly user: { readonly login: string } | null;
  readonly labels: readonly { readonly name: string }[];
  readonly updated_at: string;
  readonly state?: string;
  readonly pull_request?: unknown;
}

const toAgentIssue = (issue: IssuePayload): AgentIssue => ({
  number: issue.number,
  title: issue.title,
  body: issue.body ?? '',
  author: issue.user?.login ?? '',
  labels: issue.labels.map((label) => label.name),
  updatedAt: issue.updated_at,
});

export function httpGithubClient(repo: string, token: string): GithubClient {
  const base = `https://api.github.com/repos/${repo}`;
  const request = async (
    path: string,
    method = 'GET',
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Response> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'hexfront-agent-loop',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 403)
      throw new Error(`GitHub ${method} ${path}: 403 — у GITHUB_TOKEN нет нужного права`);
    return response;
  };
  const expectOk = async (response: Response, what: string): Promise<Response> => {
    if (!response.ok) throw new Error(`GitHub ${what}: ${response.status}`);
    return response;
  };
  const issuesPath = `/issues?state=open&labels=${AGENT_LABEL}&sort=created&direction=asc&per_page=100`;
  // Условный запрос с ETag: ответ 304 не тратит лимит API GitHub, поэтому проверять можно часто.
  const etags = new Map<string, string>();
  const changedSince = async (path: string): Promise<boolean> => {
    const previous = etags.get(path);
    const response = await request(
      path,
      'GET',
      undefined,
      previous === undefined ? {} : { 'If-None-Match': previous },
    );
    if (response.status === 304) return false;
    await expectOk(response, `проверка ${path}`);
    await response.body?.cancel();
    const etag = response.headers.get('etag');
    if (etag !== null) etags.set(path, etag);
    return previous !== undefined;
  };
  return {
    repo,
    owner: repo.split('/')[0] ?? '',
    async listIssues() {
      const response = await expectOk(await request(issuesPath), 'список Issues');
      return ((await response.json()) as IssuePayload[])
        .filter((issue) => issue.pull_request === undefined)
        .map(toAgentIssue);
    },
    async openIssue(issue) {
      const response = await expectOk(await request(`/issues/${issue}`), `Issue #${issue}`);
      const payload = (await response.json()) as IssuePayload;
      return payload.state === 'open' ? toAgentIssue(payload) : undefined;
    },
    async comment(issue, body) {
      await expectOk(await request(`/issues/${issue}/comments`, 'POST', { body }), 'комментарий');
    },
    async close(issue) {
      await expectOk(
        await request(`/issues/${issue}`, 'PATCH', { state: 'closed', state_reason: 'completed' }),
        'закрытие Issue',
      );
    },
    async addLabel(issue, label) {
      await expectOk(
        await request(`/issues/${issue}/labels`, 'POST', { labels: [label] }),
        'метка Issue',
      );
    },
    async openPullRequest(head, baseBranch, title) {
      const created = await request('/pulls', 'POST', { head, base: baseBranch, title });
      if (created.ok) return ((await created.json()) as { html_url: string }).html_url;
      if (created.status !== 422) throw new Error(`GitHub создание PR: ${created.status}`);
      const owner = repo.split('/')[0] ?? '';
      const existing = await expectOk(
        await request(`/pulls?state=open&head=${owner}:${head}&base=${baseBranch}`),
        'поиск PR',
      );
      const [pull] = (await existing.json()) as { html_url: string }[];
      if (!pull)
        throw new Error(`GitHub создание PR: 422, открытого PR ${head} → ${baseBranch} нет`);
      return pull.html_url;
    },
    async changed() {
      const issues = await changedSince(issuesPath);
      const main = await changedSince('/git/ref/heads/main');
      return issues || main;
    },
  };
}
