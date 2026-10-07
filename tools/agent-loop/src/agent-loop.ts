import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  options?: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  },
) => Promise<CommandResult>;

export interface GithubIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly labels: readonly { readonly name?: string }[];
  readonly state: string;
}

export interface GithubClient {
  ensureAgentLabel(): Promise<void>;
  listAgentIssues(): Promise<readonly GithubIssue[]>;
  comment(issueNumber: number, body: string): Promise<void>;
  close(issueNumber: number): Promise<void>;
}

export interface AgentConfig {
  readonly root: string;
  readonly maxTasks: number;
  readonly maxMinutes: number;
  readonly dryRun: boolean;
  readonly runCommand: RunCommand;
  readonly github: GithubClient;
  readonly now: () => number;
  readonly writeLine: (line: string) => void;
}

interface RoleConfig {
  readonly model: string;
  readonly reasoningEffort: string;
  readonly skill: string;
}

const ROLES: Record<string, RoleConfig> = {
  planner: { model: 'gpt-6-astra', reasoningEffort: 'high', skill: 'plan' },
  tester: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', skill: 'tests' },
  coder: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', skill: 'code' },
  reviewer: { model: 'gpt-6-astra', reasoningEffort: 'high', skill: 'review' },
};

type Role = 'planner' | 'tester' | 'coder' | 'reviewer';

const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  planner: ['docs/stages/**', 'docs/STATUS.md', 'docs/QUESTIONS.md'],
  tester: ['**/test/**', '**/*.test.ts'],
  coder: [
    'packages/*/src/**',
    'apps/*/src/**',
    'tools/*/src/**',
    'package.json',
    '**/package.json',
    '**/tsconfig.json',
    '*.config.*',
  ],
  reviewer: ['docs/stages/**', 'docs/STATUS.md', 'docs/reports/**'],
};

const runProcess: RunCommand = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => child.kill(), options.timeoutMs);
    child.on('close', (code) => {
      if (timer !== undefined) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

const defaultCommand: RunCommand = (command, args, options) => runProcess(command, args, options);

const git = async (config: AgentConfig, args: readonly string[]): Promise<string> => {
  const result = await config.runCommand('git', args, { cwd: config.root });
  if (result.code !== 0)
    throw new Error(result.stderr || `git ${args.join(' ')} завершился с ошибкой`);
  return result.stdout.trim();
};

const isOwnerTask = (text: string): boolean =>
  /плейтест|при[её]мк|задач[ауы] владельца|команда владельца/i.test(text);

const hasPlan = (text: string): boolean => /(^|\n)\s*\*?План\*?\s*:/i.test(text);

const firstLine = (text: string): string => text.trim().split(/\r?\n/, 1)[0] ?? '';

const lastLines = (text: string, count: number): string =>
  text.trim().split(/\r?\n/).slice(-count).join('\n');

export function selectIssueOrQueue(
  issues: readonly GithubIssue[],
  status: string,
):
  | { readonly issue?: GithubIssue; readonly task: string; readonly source: 'issue' | 'queue' }
  | undefined {
  const issue = [...issues]
    .filter((item) => item.state === 'open' && item.labels.some((label) => label.name === 'agent'))
    .sort((a, b) => a.number - b.number)[0];
  if (issue)
    return {
      issue,
      task: `Issue #${issue.number}: ${issue.title}\n${issue.body ?? ''}`,
      source: 'issue',
    };
  const queue = status.match(/Очередь:\s*([^\s→]+)/);
  return queue?.[1] ? { task: queue[1], source: 'queue' } : undefined;
}

const runAgent = async (
  config: AgentConfig,
  role: Role,
  task: string,
  feedback = '',
): Promise<{
  readonly result: CommandResult;
  readonly tokens?: number;
  readonly message: string;
}> => {
  const roleConfig = ROLES[role] as RoleConfig;
  const outputDir = await mkdtemp(join(tmpdir(), 'hexfront-agent-'));
  const outputFile = join(outputDir, 'last-message.txt');
  const prompt = `Роль: ${role}. Скилл: $${roleConfig.skill}. Задача: ${task}${feedback ? `\nОбратная связь:\n${feedback}` : ''}`;
  const result = await config.runCommand(
    'codex',
    [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      roleConfig.model,
      '-c',
      `model_reasoning_effort="${roleConfig.reasoningEffort}"`,
      '--output-last-message',
      outputFile,
      '--json',
      '--cd',
      config.root,
      prompt,
    ],
    {
      cwd: config.root,
      env: { ...process.env, AGENT_ROLE: role },
      timeoutMs: config.maxMinutes * 60_000,
    },
  );
  let message = result.stdout;
  try {
    message = await readFile(outputFile, 'utf8');
  } catch {
    /* Codex мог завершиться до записи файла. */
  }
  const usage = result.stdout.match(/(?:total_tokens|tokens)[^\d]*(\d+)/i);
  await rm(outputDir, { recursive: true, force: true });
  return { result, message, ...(usage?.[1] ? { tokens: Number(usage[1]) } : {}) };
};

const globToRegExp = (glob: string): RegExp => {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLE_STAR__/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
};

const checkPermissions = async (
  config: AgentConfig,
  base: string,
  role: Role,
): Promise<boolean> => {
  const names = await git(config, ['diff', '--name-only', `${base}..HEAD`]);
  const dirty = await git(config, ['status', '--porcelain']);
  const changed = [...names.split(/\r?\n/), ...dirty.split(/\r?\n/).map((line) => line.slice(3))]
    .map((name) => relative(config.root, join(config.root, name.trim())).replaceAll('\\', '/'))
    .filter(Boolean);
  return changed.every((name) =>
    ROLE_PERMISSIONS[role].some((glob) => globToRegExp(glob).test(name)),
  );
};

export async function runAgentLoop(config: AgentConfig): Promise<number> {
  const logPath = join(
    config.root,
    '.ai-logs',
    `agent-loop-${new Date(config.now()).toISOString().slice(0, 10)}.md`,
  );
  const log = async (line: string): Promise<void> => appendFile(logPath, `${line}\n`, 'utf8');
  const status = await readFile(join(config.root, 'docs/STATUS.md'), 'utf8');
  await config.github.ensureAgentLabel();
  const selected = selectIssueOrQueue(await config.github.listAgentIssues(), status);
  if (!selected) return 1;
  if (config.dryRun) {
    config.writeLine(`planner → tester → coder → reviewer: ${selected.task}`);
    return 0;
  }
  const branch = await git(config, ['branch', '--show-current']);
  const expectedBranch = status.match(/Ветка\s*\|\s*`([^`]+)`/)?.[1];
  if (expectedBranch !== undefined && branch !== expectedBranch) return 1;
  if ((await git(config, ['status', '--porcelain'])) !== '') return 1;
  if (isOwnerTask(selected.task)) {
    if (selected.issue)
      await config.github.comment(
        selected.issue.number,
        'Стоп: задача владельца требует ручного действия.',
      );
    return 1;
  }
  const startedAt = config.now();
  const taskCount = 0;
  let task = selected.task;
  let testerRetry = 0;
  let reviewerRetry = 0;
  while (taskCount < config.maxTasks && config.now() - startedAt <= config.maxMinutes * 60_000) {
    const roles: Role[] = [];
    const stageStatus = await readFile(
      join(config.root, 'docs/stages/stage-05-bots-maps-balance.md'),
      'utf8',
    );
    if (!hasPlan(stageStatus)) roles.push('planner');
    roles.push('tester', 'coder');
    for (const role of roles) {
      const base = await git(config, ['rev-parse', 'HEAD']);
      const roleStartedAt = config.now();
      const agent = await runAgent(config, role, task);
      await log(
        `- роль: ${role}; длительность: ${config.now() - roleStartedAt} мс; коммит до: ${base}; токены: ${agent.tokens ?? 'нет'}; итог: ${firstLine(agent.message)}`,
      );
      if (agent.result.code !== 0) return 1;
      if (!(await checkPermissions(config, base, role))) {
        await git(config, ['reset', '--hard', base]);
        return 1;
      }
      if (role === 'tester' && !hasPlan(agent.message) && /ТЕСТ:/i.test(agent.message)) {
        config.writeLine(`tester: ${firstLine(agent.message)}`);
      }
      if (role === 'coder' && /^ТЕСТ:/im.test(agent.message)) {
        if (testerRetry++ > 0) return 1;
        const retry = await runAgent(config, 'tester', task, lastLines(agent.message, 15));
        if (retry.result.code !== 0) return 1;
      }
    }
    const push = await config.runCommand('git', ['push', 'origin', 'stage-05'], {
      cwd: config.root,
    });
    if (push.code !== 0) return 1;
    const ci = await config.runCommand('pnpm', ['ci:wait'], {
      cwd: config.root,
      timeoutMs: 660_000,
    });
    if (ci.code !== 0) {
      if (testerRetry++ > 0) return 1;
      const repair = await runAgent(config, 'coder', task, lastLines(ci.stdout + ci.stderr, 15));
      if (repair.result.code !== 0) return 1;
      continue;
    }
    const review = await runAgent(config, 'reviewer', task);
    if (review.result.code !== 0) return 1;
    if (firstLine(review.message) === 'OK') {
      if (selected.issue) {
        await config.github.comment(
          selected.issue.number,
          'OK: verify и критерии задачи подтверждены reviewer.',
        );
        await config.github.close(selected.issue.number);
      }
      return 0;
    }
    if (reviewerRetry++ > 0) return 1;
    task = `${task}\nИсправь возврат reviewer:\n${lastLines(review.message, 15)}`;
  }
  return 1;
}

export const defaultRunCommand = defaultCommand;
