import { execFileSync } from 'node:child_process';

import { defaultRunCommand, runAgentLoop, type GithubClient } from './agent-loop.ts';

const repo = (): string => {
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  return remote.replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
};

const githubClient = (): GithubClient => {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hexfront-agent-loop',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const base = `https://api.github.com/repos/${repo()}`;
  const request = async (url: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${base}${url}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  return {
    async ensureAgentLabel() {
      const response = await request('/labels/agent');
      if (response.ok) return;
      if (response.status !== 404) throw new Error(`GitHub label ${response.status}`);
      const created = await request('/labels', {
        method: 'POST',
        body: JSON.stringify({ name: 'agent' }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (created.status === 403) throw new Error('GitHub token не имеет права Issues: write');
      if (!created.ok && created.status !== 422)
        throw new Error(`GitHub label create ${created.status}`);
    },
    async listAgentIssues() {
      const response = await request('/issues?state=open&labels=agent&per_page=100');
      if (!response.ok) throw new Error(`GitHub Issues ${response.status}`);
      return (await response.json()) as Awaited<ReturnType<GithubClient['listAgentIssues']>>;
    },
    async comment(issueNumber, body) {
      const response = await request(`/issues/${issueNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.status === 403) throw new Error('GitHub token не имеет права Issues: write');
      if (!response.ok) throw new Error(`GitHub comment ${response.status}`);
    },
    async close(issueNumber) {
      const response = await request(`/issues/${issueNumber}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.status === 403) throw new Error('GitHub token не имеет права Issues: write');
      if (!response.ok) throw new Error(`GitHub close ${response.status}`);
    },
  };
};

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

const maxTasks = Number(flag('--max-tasks') ?? 3);
const maxMinutes = Number(flag('--max-minutes') ?? 120);
const root = process.cwd();
process.exitCode = await runAgentLoop({
  root,
  maxTasks,
  maxMinutes,
  dryRun: process.argv.includes('--dry-run'),
  runCommand: defaultRunCommand,
  github: githubClient(),
  now: Date.now,
  writeLine: console.log,
});
