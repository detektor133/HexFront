import { appendFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { prepareProcessArguments, type CommandResult, type RunCommand } from './process.ts';
import {
  isOwnerTask,
  reviewTasks,
  selectTask,
  taskBlock,
  taskMark,
  type TaskMark,
} from './stage-file.ts';

export {
  defaultRunCommand,
  prepareProcessArguments,
  quoteWindowsArgument,
  type CommandResult,
  type RunCommand,
} from './process.ts';

export interface AgentConfig {
  readonly root: string;
  readonly maxTasks: number;
  readonly maxRounds: number;
  readonly maxMinutes: number;
  readonly dryRun: boolean;
  readonly runCommand: RunCommand;
  readonly now: () => number;
  readonly writeLine: (line: string) => void;
}
interface RoleConfig {
  readonly model?: string;
  readonly reasoningEffort: string;
}
type Role = 'next' | 'review';
interface AgentDefinitions {
  readonly roles: Readonly<Record<Role, RoleConfig>>;
  readonly reviewerPaths: readonly string[];
}
/** Строка в консоль и в протокол `.ai-logs/agent-loop-<дата>.md`. */
type Say = (line: string) => Promise<void>;
type Stopped = { readonly ok: false; readonly code: number };
type Outcome = { readonly ok: true } | Stopped;

const CI_TIMEOUT_MS = 660_000;
/** Как часто печатать «сессия ещё идёт», мс. */
const HEARTBEAT_MS = 60_000;
const OK: Outcome = { ok: true };

const git = async (config: AgentConfig, args: readonly string[]): Promise<string> => {
  const result = await config.runCommand('git', args, { cwd: config.root });
  if (result.code !== 0)
    throw new Error(result.stderr || `git ${args.join(' ')} завершился с ошибкой`);
  return result.stdout.trim();
};

const firstLine = (text: string): string => text.trim().split(/\r?\n/, 1)[0] ?? '';
const lastLines = (text: string, count = 15): string =>
  text.trim().split(/\r?\n/).slice(-count).join('\n');
const minutes = (ms: number): string => `${Math.max(0, Math.round(ms / 60_000))} мин`;
export async function loadAgentDefinitions(root: string): Promise<AgentDefinitions> {
  const [rolesText, permissionsText] = await Promise.all([
    readFile(join(root, 'tools/agent-loop/roles.json'), 'utf8'),
    readFile(join(root, 'tools/agent-loop/permissions.json'), 'utf8'),
  ]);
  const roles = JSON.parse(rolesText) as Partial<Record<Role, RoleConfig>>;
  const permissions = JSON.parse(permissionsText) as { readonly reviewer?: readonly string[] };
  if (!roles.next || !roles.review) throw new Error('В roles.json нужны роли next и review');
  return {
    roles: { next: roles.next, review: roles.review },
    reviewerPaths: permissions.reviewer ?? [],
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

/** @returns true, если коммиты и незакоммиченные файлы после base лежат в разрешённых путях. */
export async function checkPermissions(
  config: AgentConfig,
  base: string,
  allowed: readonly string[],
): Promise<boolean> {
  const names = await git(config, ['diff', '--name-only', `${base}..HEAD`]);
  const dirty = await git(config, ['status', '--porcelain']);
  const changed = [...names.split(/\r?\n/), ...dirty.split(/\r?\n/).map((line) => line.slice(3))]
    .map((name) => relative(config.root, join(config.root, name.trim())).replaceAll('\\', '/'))
    .filter(Boolean);
  return changed.every((name) => allowed.some((glob) => globToRegExp(glob).test(name)));
}

interface StageState {
  readonly stage: string;
  readonly status: string;
  readonly stageText: string;
}

async function readStage(root: string): Promise<StageState> {
  const status = await readFile(join(root, 'docs/STATUS.md'), 'utf8');
  const stage = status.match(/Текущий этап\s*\|\s*(\d+)/)?.[1];
  if (!stage) throw new Error('В docs/STATUS.md не найден текущий этап');
  const name = (await readdir(join(root, 'docs/stages'))).find((file) =>
    file.startsWith(`stage-${stage}-`),
  );
  if (!name) throw new Error(`Файл этапа ${stage} не найден`);
  return { stage, status, stageText: await readFile(join(root, 'docs/stages', name), 'utf8') };
}

/** Полный вывод сессии — в `.ai-logs/agent-loop/`, вне git: в консоль и протокол идут только итоги. */
async function saveSessionLog(
  config: AgentConfig,
  prompt: string,
  result: CommandResult,
): Promise<string> {
  const directory = join(config.root, '.ai-logs', 'agent-loop');
  await mkdir(directory, { recursive: true });
  const name = `${new Date(config.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`;
  const text = `$ codex exec: ${prompt}\nкод: ${result.code}\n\n${result.stdout}\n\n--- stderr ---\n${result.stderr}\n`;
  await appendFile(join(directory, name), text, 'utf8');
  return `.ai-logs/agent-loop/${name}`;
}

async function runCodex(
  config: AgentConfig,
  definitions: AgentDefinitions,
  role: Role,
  prompt: string,
): Promise<{ readonly result: CommandResult; readonly message: string; readonly log: string }> {
  const roleConfig = definitions.roles[role];
  const outputDir = await mkdtemp(join(tmpdir(), 'hexfront-agent-'));
  const outputFile = join(outputDir, 'last-message.txt');
  const started = config.now();
  const heartbeat = setInterval(
    () => config.writeLine(`  … ${prompt} идёт ${minutes(config.now() - started)}`),
    HEARTBEAT_MS,
  );
  let result: CommandResult;
  try {
    result = await config.runCommand(
      'codex',
      prepareProcessArguments([
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        ...(roleConfig.model ? ['--model', roleConfig.model] : []),
        '-c',
        `model_reasoning_effort=${roleConfig.reasoningEffort}`,
        '--output-last-message',
        outputFile,
        '--cd',
        config.root,
        '-',
      ]),
      {
        cwd: config.root,
        // $next пишет код, тесты и docs, поэтому роль у него пустая: хук прав его не ограничивает.
        env: { ...process.env, AGENT_ROLE: role === 'review' ? 'reviewer' : '' },
        input: prompt,
        timeoutMs: config.maxMinutes * 60_000,
      },
    );
  } finally {
    clearInterval(heartbeat);
  }
  const message = await readFile(outputFile, 'utf8').catch(
    (error: unknown) => `${result.stdout}\n(последний ответ не записан: ${String(error)})`,
  );
  await rm(outputDir, { recursive: true, force: true });
  return { result, message, log: await saveSessionLog(config, prompt, result) };
}

function makeStop(say: Say) {
  return async (step: string, reason: string, answer = ''): Promise<Stopped> => {
    await say(`стоп: ${step} — ${reason}`);
    if (answer.trim() !== '') await say(lastLines(answer, 10));
    return { ok: false, code: 1 };
  };
}

/** Ждёт CI на HEAD силами скрипта; обрыв по таймауту повторяется один раз, как в $next. */
async function waitCi(config: AgentConfig, say: Say, step: string): Promise<CommandResult> {
  const started = config.now();
  await say(`… жду CI ${step}`);
  let ci = await config.runCommand('pnpm', ['ci:wait'], {
    cwd: config.root,
    timeoutMs: CI_TIMEOUT_MS,
  });
  if (ci.code !== 0 && /failure timeout|run=not-found/.test(ci.stdout))
    ci = await config.runCommand('pnpm', ['ci:wait'], {
      cwd: config.root,
      timeoutMs: CI_TIMEOUT_MS,
    });
  await say(
    `CI ${ci.code === 0 ? 'зелёный' : 'красный'} за ${minutes(config.now() - started)}: ${firstLine(lastLines(ci.stdout, 1))}`,
  );
  return ci;
}

/** Проверяет, что после роли дерево чистое, а ветка запушена (скиллы пушат сами). */
async function checkPushed(config: AgentConfig, stop: ReturnType<typeof makeStop>, step: string) {
  if ((await git(config, ['status', '--porcelain'])) !== '')
    return stop(step, 'после сессии рабочее дерево не чистое');
  const branch = await git(config, ['branch', '--show-current']);
  await git(config, ['fetch', 'origin', branch]);
  if (
    (await git(config, ['rev-parse', 'HEAD'])) !==
    (await git(config, ['rev-parse', `origin/${branch}`]))
  )
    return stop(step, `HEAD не совпадает с origin/${branch}: сессия не запушила коммит`);
  return OK;
}

interface LoopContext {
  readonly config: AgentConfig;
  readonly definitions: AgentDefinitions;
  readonly say: Say;
  readonly stop: ReturnType<typeof makeStop>;
}

/** `$next` в новой сессии; успех — ровно одна задача стала `[~]`, коммит запушен, CI зелёный. */
async function runNext(context: LoopContext, expected: string): Promise<string | Outcome> {
  const { config, definitions, say, stop } = context;
  const base = await git(config, ['rev-parse', 'HEAD']);
  const started = config.now();
  await say(`→ $next (новая сессия codex)`);
  const next = await runCodex(config, definitions, 'next', '$next');
  await say(
    `← $next за ${minutes(config.now() - started)}: ${firstLine(next.message)} (лог ${next.log})`,
  );
  if (next.result.code !== 0)
    return stop(
      '$next',
      `codex завершился с кодом ${next.result.code}`,
      next.message + next.result.stderr,
    );
  const state = await readStage(config.root);
  const waiting = reviewTasks(state.stageText, state.stage);
  if (waiting.length !== 1 || (await git(config, ['rev-parse', 'HEAD'])) === base)
    return stop(
      '$next',
      'задача не отмечена [~] — $next остановился сам (см. его ответ)',
      next.message,
    );
  if (waiting[0] !== expected) await say(`$next взял ${waiting[0]} вместо ${expected}`);
  const pushed = await checkPushed(config, stop, '$next');
  if (!pushed.ok) return pushed;
  const ci = await waitCi(config, say, `после $next ${waiting[0] ?? ''}`);
  if (ci.code !== 0) return stop('CI после $next', 'CI красный', ci.stdout + ci.stderr);
  return waiting[0] ?? expected;
}

/** `$review` в новой сессии; возвращает новую отметку задачи. */
async function runReview(context: LoopContext, task: string): Promise<TaskMark | Outcome> {
  const { config, definitions, say, stop } = context;
  const base = await git(config, ['rev-parse', 'HEAD']);
  const started = config.now();
  await say(`→ $review ${task} (новая сессия codex)`);
  const review = await runCodex(config, definitions, 'review', `$review ${task}`);
  await say(
    `← $review за ${minutes(config.now() - started)}: ${firstLine(review.message)} (лог ${review.log})`,
  );
  if (review.result.code !== 0)
    return stop(
      '$review',
      `codex завершился с кодом ${review.result.code}`,
      review.message + review.result.stderr,
    );
  // Ревью уже запушило коммит, поэтому откат здесь только развёл бы локальную и удалённую ветку.
  if (!(await checkPermissions(config, base, definitions.reviewerPaths)))
    return stop(
      '$review',
      'ревью изменило файлы вне permissions.json — проверь коммит',
      review.message,
    );
  const pushed = await checkPushed(config, stop, '$review');
  if (!pushed.ok) return pushed;
  const mark = taskMark((await readStage(config.root)).stageText, task);
  const verdict = firstLine(review.message);
  if (mark === 'x' && verdict === 'OK') return mark;
  if (mark === ' ' && verdict.startsWith('ВОЗВРАТ')) return mark;
  return stop(
    '$review',
    `ответ «${verdict}» не совпадает с отметкой [${mark ?? '?'}]`,
    review.message,
  );
}

/** Круги $next → CI → $review по одной задаче, не больше maxRounds. */
async function processTask(
  context: LoopContext,
  selected: string,
  mark: TaskMark,
): Promise<Outcome> {
  const { config, say, stop } = context;
  let task = selected;
  let needsNext = mark === ' ';
  for (let round = 1; round <= config.maxRounds; round += 1) {
    if (needsNext) {
      const next = await runNext(context, task);
      if (typeof next !== 'string') return next;
      task = next;
    }
    const verdict = await runReview(context, task);
    if (typeof verdict !== 'string') return verdict;
    if (verdict === 'x') return OK;
    await say(`ВОЗВРАТ ${task}, круг ${round} из ${config.maxRounds}`);
    needsNext = true;
  }
  return stop('круги', `${config.maxRounds} ВОЗВРАТ подряд по ${task} — нужно решение владельца`);
}

async function preflight(context: LoopContext): Promise<Outcome> {
  const { config, stop } = context;
  const { status } = await readStage(config.root);
  const branch = await git(config, ['branch', '--show-current']);
  const expected = status.match(/Ветка\s*\|\s*`([^`]+)`/)?.[1];
  if (expected !== undefined && branch !== expected)
    return stop('проверка ветки', `ожидалась ${expected}, найдена ${branch}`);
  if ((await git(config, ['status', '--porcelain'])) !== '')
    return stop('проверка дерева', 'рабочее дерево не чистое');
  return OK;
}

/** Выбирает задачу очереди; задача владельца или пустая очередь — остановка. */
async function nextTask(
  context: LoopContext,
): Promise<{ readonly task: string; readonly mark: TaskMark } | Stopped> {
  const { config, stop } = context;
  const state = await readStage(config.root);
  const task = selectTask(state.status, state.stageText);
  if (!task) return stop('выбор задачи', 'в очереди нет открытых задач — запусти $stage-close');
  const block = taskBlock(state.stageText, task);
  if (isOwnerTask(block))
    return stop(
      'выбор задачи',
      `очередь дошла до ${task} — это задача владельца`,
      firstLine(block),
    );
  return { task, mark: taskMark(state.stageText, task) ?? ' ' };
}

export async function runAgentLoop(config: AgentConfig): Promise<number> {
  await mkdir(join(config.root, '.ai-logs'), { recursive: true });
  const logPath = join(
    config.root,
    '.ai-logs',
    `agent-loop-${new Date(config.now()).toISOString().slice(0, 10)}.md`,
  );
  const say: Say = async (line) => {
    config.writeLine(line);
    await appendFile(logPath, `- ${new Date(config.now()).toISOString()} ${line}\n`, 'utf8');
  };
  const context: LoopContext = {
    config,
    definitions: await loadAgentDefinitions(config.root),
    say,
    stop: makeStop(say),
  };
  if (config.dryRun) {
    const selected = await nextTask(context);
    if (!('task' in selected)) return 1;
    config.writeLine(
      `${selected.mark === '~' ? '$review' : '$next → CI → $review'}: ${selected.task}`,
    );
    return 0;
  }
  const ready = await preflight(context);
  if (!ready.ok) return ready.code;
  const started = config.now();
  await say(`старт: задач ≤ ${config.maxTasks}, кругов на задачу ≤ ${config.maxRounds}`);
  let done = 0;
  while (done < config.maxTasks && config.now() - started <= config.maxMinutes * 60_000) {
    const selected = await nextTask(context);
    if (!('task' in selected)) return done > 0 ? 0 : selected.code;
    await say(`задача ${selected.task} [${selected.mark}]`);
    const outcome = await processTask(context, selected.task, selected.mark);
    if (!outcome.ok) return outcome.code;
    done += 1;
    await say(`готово: ${selected.task} (${done} из ${config.maxTasks})`);
  }
  await say(`итог: задач ${done}, ${minutes(config.now() - started)}`);
  return 0;
}
