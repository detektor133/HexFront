import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
interface PermissionConfig {
  readonly [role: string]: readonly string[];
}
interface AgentDefinitions {
  readonly roles: Record<string, RoleConfig>;
  readonly permissions: PermissionConfig;
}
type Role = 'planner' | 'tester' | 'coder' | 'reviewer';
type TaskSelection = {
  readonly issue?: GithubIssue;
  readonly task: string;
  readonly number?: number;
};

const ROLE_NAMES: readonly Role[] = ['planner', 'tester', 'coder', 'reviewer'];

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

const git = async (config: AgentConfig, args: readonly string[]): Promise<string> => {
  const result = await config.runCommand('git', args, { cwd: config.root });
  if (result.code !== 0)
    throw new Error(result.stderr || `git ${args.join(' ')} завершился с ошибкой`);
  return result.stdout.trim();
};

const firstLine = (text: string): string => text.trim().split(/\r?\n/, 1)[0] ?? '';
const lastLines = (text: string, count = 15): string =>
  text.trim().split(/\r?\n/).slice(-count).join('\n');
const isOwnerTask = (text: string): boolean =>
  /плейтест|при[её]мк|задач[ауы] владельца|команда владельца/i.test(text);
const isTestReply = (text: string): boolean => /^ТЕСТ:/im.test(text);
const isReturnReply = (text: string): boolean => /^ВОЗВРАТ(?:\s|$)/im.test(text);

export async function loadAgentDefinitions(root: string): Promise<AgentDefinitions> {
  const [rolesText, permissionsText] = await Promise.all([
    readFile(join(root, 'tools/agent-loop/roles.json'), 'utf8'),
    readFile(join(root, 'tools/agent-loop/permissions.json'), 'utf8'),
  ]);
  return {
    roles: JSON.parse(rolesText) as Record<string, RoleConfig>,
    permissions: JSON.parse(permissionsText) as PermissionConfig,
  };
}

const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '__DOUBLE_STAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__DOUBLE_STAR__/g, '.*')}$`,
    'i',
  );

export async function checkPermissions(
  config: AgentConfig,
  base: string,
  role: Role,
  definitions: AgentDefinitions,
): Promise<boolean> {
  const names = await git(config, ['diff', '--name-only', `${base}..HEAD`]);
  const dirty = await git(config, ['status', '--porcelain']);
  const changed = [...names.split(/\r?\n/), ...dirty.split(/\r?\n/).map((line) => line.slice(3))]
    .map((name) => relative(config.root, join(config.root, name.trim())).replaceAll('\\', '/'))
    .filter(Boolean);
  return changed.every(
    (name) => definitions.permissions[role]?.some((glob) => globToRegExp(glob).test(name)) ?? false,
  );
}

async function resolveStageFile(root: string, status: string): Promise<string> {
  const stage = status.match(/Текущий этап\s*\|\s*(\d+)/)?.[1];
  if (!stage) throw new Error('В docs/STATUS.md не найден текущий этап');
  const name = (await readdir(join(root, 'docs/stages'))).find((file) =>
    file.startsWith(`stage-${stage}-`),
  );
  if (!name) throw new Error(`Файл этапа ${stage} не найден`);
  return join(root, 'docs/stages', name);
}

function taskBlock(stageText: string, task: string): string {
  const short = task.match(/\d+\/(T[\da-z]+)/i)?.[1] ?? task.match(/\bT[\da-z]+\b/i)?.[0] ?? task;
  const start = stageText.search(new RegExp(`^[-*].*\\*?${short}\\b`, 'im'));
  if (start < 0) return '';
  const next = stageText.slice(start + 1).search(/^[-*].*\*?T[\da-z]+\b/im);
  return stageText.slice(start, next < 0 ? undefined : start + 1 + next);
}

const hasPlan = (block: string): boolean => /(^|\n)\s*\*?План\*?\s*:/i.test(block);

export function selectIssueOrQueue(
  issues: readonly GithubIssue[],
  status: string,
  usedIssues: ReadonlySet<number> = new Set(),
  usedTasks: ReadonlySet<string> = new Set(),
): TaskSelection | undefined {
  const issue = [...issues]
    .filter(
      (item) =>
        item.state === 'open' &&
        !usedIssues.has(item.number) &&
        item.labels.some((label) => label.name === 'agent'),
    )
    .sort((a, b) => a.number - b.number)[0];
  if (issue)
    return {
      issue,
      number: issue.number,
      task: `Issue #${issue.number}: ${issue.title}\n${issue.body ?? ''}`,
    };
  const queue = status
    .match(/Очередь:\s*([^\r\n]+)/)?.[1]
    ?.split('→')
    .map((item) => item.trim())
    .filter(Boolean);
  const task = queue?.find((item) => !usedTasks.has(item));
  return task ? { task } : undefined;
}

async function runAgent(
  config: AgentConfig,
  definitions: AgentDefinitions,
  role: Role,
  task: string,
  feedback = '',
): Promise<{ readonly result: CommandResult; readonly message: string; readonly tokens?: number }> {
  const roleConfig = definitions.roles[role];
  if (!roleConfig || !ROLE_NAMES.includes(role)) throw new Error(`Конфиг роли ${role} не найден`);
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
    /* stdout — резерв, если CLI не записал файл. */
  }
  const usage = result.stdout.match(/(?:total_tokens|tokens)[^\d]*(\d+)/i);
  await rm(outputDir, { recursive: true, force: true });
  return { result, message, ...(usage?.[1] ? { tokens: Number(usage[1]) } : {}) };
}

async function stop(
  config: AgentConfig,
  selected: TaskSelection,
  log: (line: string) => Promise<void>,
  step: string,
  reason: string,
  answer: string,
): Promise<number> {
  const detail = `Стоп: шаг ${step}; причина: ${reason}; последние строки:\n${lastLines(answer)}`;
  if (selected.issue) await config.github.comment(selected.issue.number, detail);
  await log(`- стоп: шаг ${step}; причина: ${reason}; ответ: ${lastLines(answer)}`);
  config.writeLine(`стоп: ${step} — ${reason}`);
  return 1;
}

async function callRole(
  config: AgentConfig,
  definitions: AgentDefinitions,
  selected: TaskSelection,
  log: (line: string) => Promise<void>,
  role: Role,
  task: string,
  feedback = '',
): Promise<
  { readonly ok: true; readonly message: string } | { readonly ok: false; readonly code: number }
> {
  const base = await git(config, ['rev-parse', 'HEAD']);
  const started = config.now();
  const agent = await runAgent(config, definitions, role, task, feedback);
  await log(
    `- роль: ${role}; длительность: ${config.now() - started} мс; коммит до: ${base}; токены: ${agent.tokens ?? 'нет'}; итог: ${firstLine(agent.message)}`,
  );
  if (agent.result.code !== 0)
    return {
      ok: false,
      code: await stop(
        config,
        selected,
        log,
        role,
        `codex завершился с кодом ${agent.result.code}`,
        agent.message,
      ),
    };
  if (!(await checkPermissions(config, base, role, definitions))) {
    await git(config, ['reset', '--hard', base]);
    return {
      ok: false,
      code: await stop(
        config,
        selected,
        log,
        role,
        'нарушены права записи роли; выполнен откат',
        agent.message,
      ),
    };
  }
  return { ok: true, message: agent.message };
}

async function pushAndCi(
  config: AgentConfig,
  selected: TaskSelection,
  log: (line: string) => Promise<void>,
  step: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly output: string }> {
  const push = await config.runCommand(
    'git',
    ['push', 'origin', await git(config, ['branch', '--show-current'])],
    { cwd: config.root },
  );
  if (push.code !== 0) {
    await stop(config, selected, log, step, 'git push завершился с ошибкой', push.stderr);
    return { ok: false, output: push.stderr };
  }
  const ci = await config.runCommand('pnpm', ['ci:wait'], { cwd: config.root, timeoutMs: 660_000 });
  await log(`- CI: шаг ${step}; код: ${ci.code}; вывод: ${lastLines(ci.stdout + ci.stderr)}`);
  if (ci.code !== 0) return { ok: false, output: ci.stdout + ci.stderr };
  return { ok: true };
}

async function processTask(
  config: AgentConfig,
  definitions: AgentDefinitions,
  selected: TaskSelection,
  stageFile: string,
  log: (line: string) => Promise<void>,
): Promise<number> {
  if (isOwnerTask(selected.task))
    return stop(config, selected, log, 'выбор задачи', 'задача владельца', selected.task);
  const stageText = await readFile(stageFile, 'utf8');
  const block = taskBlock(stageText, selected.task);
  const questionsFile = join(config.root, 'docs/QUESTIONS.md');
  const beforeQuestions = await readFile(questionsFile, 'utf8');
  if (!hasPlan(block)) {
    const planner = await callRole(config, definitions, selected, log, 'planner', selected.task);
    if (!planner.ok) return planner.code;
    if ((await readFile(questionsFile, 'utf8')) !== beforeQuestions)
      return stop(
        config,
        selected,
        log,
        'planner',
        'planner изменил docs/QUESTIONS.md',
        planner.message,
      );
  }
  const tester = await callRole(config, definitions, selected, log, 'tester', selected.task);
  if (!tester.ok) return tester.code;
  let coder = await callRole(config, definitions, selected, log, 'coder', selected.task);
  if (!coder.ok) return coder.code;
  if (isTestReply(coder.message)) {
    const retryTester = await callRole(
      config,
      definitions,
      selected,
      log,
      'tester',
      selected.task,
      lastLines(coder.message),
    );
    if (!retryTester.ok) return retryTester.code;
    coder = await callRole(
      config,
      definitions,
      selected,
      log,
      'coder',
      selected.task,
      lastLines(retryTester.message),
    );
    if (!coder.ok) return coder.code;
    if (isTestReply(coder.message))
      return stop(config, selected, log, 'coder', 'второй ответ ТЕСТ:', coder.message);
  }
  let ci = await pushAndCi(config, selected, log, 'CI после coder');
  if (!ci.ok) {
    const repair = await callRole(
      config,
      definitions,
      selected,
      log,
      'coder',
      selected.task,
      lastLines(ci.output),
    );
    if (!repair.ok) return repair.code;
    ci = await pushAndCi(config, selected, log, 'CI после ремонта coder');
    if (!ci.ok) return stop(config, selected, log, 'CI', 'второй красный CI', ci.output);
  }
  let reviewer = await callRole(config, definitions, selected, log, 'reviewer', selected.task);
  if (!reviewer.ok) return reviewer.code;
  if (isReturnReply(reviewer.message)) {
    const repair = await callRole(
      config,
      definitions,
      selected,
      log,
      'coder',
      selected.task,
      lastLines(reviewer.message),
    );
    if (!repair.ok) return repair.code;
    ci = await pushAndCi(config, selected, log, 'CI после ВОЗВРАТ');
    if (!ci.ok)
      return stop(config, selected, log, 'ВОЗВРАТ/CI', 'красный CI после возврата', ci.output);
    reviewer = await callRole(config, definitions, selected, log, 'reviewer', selected.task);
    if (!reviewer.ok) return reviewer.code;
    if (isReturnReply(reviewer.message))
      return stop(config, selected, log, 'reviewer', 'второй ВОЗВРАТ', reviewer.message);
  }
  if (firstLine(reviewer.message) !== 'OK')
    return stop(config, selected, log, 'reviewer', 'неизвестный ответ reviewer', reviewer.message);
  const push = await config.runCommand(
    'git',
    ['push', 'origin', await git(config, ['branch', '--show-current'])],
    { cwd: config.root },
  );
  if (push.code !== 0)
    return stop(
      config,
      selected,
      log,
      'push reviewer',
      'git push завершился с ошибкой',
      push.stderr,
    );
  if (selected.issue) {
    await config.github.comment(
      selected.issue.number,
      'OK: verify и критерии задачи подтверждены reviewer.',
    );
    await config.github.close(selected.issue.number);
  }
  return 0;
}

export async function runAgentLoop(config: AgentConfig): Promise<number> {
  const logPath = join(
    config.root,
    '.ai-logs',
    `agent-loop-${new Date(config.now()).toISOString().slice(0, 10)}.md`,
  );
  const log = async (line: string): Promise<void> => appendFile(logPath, `${line}\n`, 'utf8');
  const status = await readFile(join(config.root, 'docs/STATUS.md'), 'utf8');
  const definitions = await loadAgentDefinitions(config.root);
  await config.github.ensureAgentLabel();
  const stageFile = await resolveStageFile(config.root, status);
  const usedIssues = new Set<number>();
  const usedTasks = new Set<string>();
  let taskCount = 0;
  const started = config.now();
  const summary: string[] = [];
  const select = async (): Promise<TaskSelection | undefined> =>
    selectIssueOrQueue(await config.github.listAgentIssues(), status, usedIssues, usedTasks);
  if (config.dryRun) {
    const selected = await select();
    config.writeLine(
      selected ? `planner → tester → coder → reviewer: ${selected.task}` : 'задачи не найдены',
    );
    return selected ? 0 : 1;
  }
  const branch = await git(config, ['branch', '--show-current']);
  const expectedBranch = status.match(/Ветка\s*\|\s*`([^`]+)`/)?.[1];
  const preflightTask: TaskSelection = { task: 'проверка репозитория' };
  if (expectedBranch !== undefined && branch !== expectedBranch)
    return stop(
      config,
      preflightTask,
      log,
      'проверка ветки',
      `ожидалась ${expectedBranch}, найдена ${branch}`,
      '',
    );
  if ((await git(config, ['status', '--porcelain'])) !== '')
    return stop(config, preflightTask, log, 'проверка дерева', 'рабочее дерево не чистое', '');
  while (taskCount < config.maxTasks && config.now() - started <= config.maxMinutes * 60_000) {
    const selected = await select();
    if (!selected) break;
    if (selected.number !== undefined) usedIssues.add(selected.number);
    usedTasks.add(selected.task);
    const result = await processTask(config, definitions, selected, stageFile, log);
    if (result !== 0) return result;
    taskCount += 1;
    summary.push(`готова задача ${taskCount}: ${selected.task}`);
    config.writeLine(summary.at(-1) ?? 'задача готова');
  }
  await log(
    `- итог: задач=${taskCount}; лимит=${config.maxTasks}; время=${config.now() - started} мс`,
  );
  config.writeLine(`итог: задач=${taskCount}; лимит=${config.maxTasks}; ${summary.join('; ')}`);
  return taskCount > 0 ? 0 : 1;
}

export const defaultRunCommand = runProcess;
