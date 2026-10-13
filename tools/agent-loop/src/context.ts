// Общее для шагов цикла: настройки, протокол, ожидание владельца, сессия скилла с проверками.
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { minutes, runCodex, type AgentDefinitions, type Role, type Session } from './codex.ts';
import { dirtyFiles, head, syncWithOrigin, type Git } from './git.ts';
import type { GithubClient } from './github.ts';
import type { RunCommand } from './process.ts';
import { saveState, type LoopState } from './state.ts';

export interface AgentConfig {
  readonly root: string;
  readonly maxRounds: number;
  /** Предел одной сессии codex, мин. */
  readonly maxMinutes: number;
  /** Как часто без работы проверять Issues и `main` условным запросом к GitHub, с. */
  readonly pollSeconds: number;
  /** Как часто без работы делать полный шаг (git fetch, очередь), мин. */
  readonly pollMinutes: number;
  /** Выйти, когда работы нет, вместо ожидания. */
  readonly once: boolean;
  readonly dryRun: boolean;
  /** Задача, чью незакоммиченную работу владелец разрешил доделать (`--resume`). */
  readonly resume?: string;
  readonly runCommand: RunCommand;
  readonly now: () => number;
  /** Пауза; `wake` — владелец нажал Enter в консоли цикла. */
  readonly sleep: (ms: number) => Promise<'timer' | 'wake'>;
  readonly writeLine: (line: string) => void;
  readonly github?: GithubClient;
}
/** `worked` — что-то сделано, сразу следующий шаг; `idle` — ждать Issue или нового коммита. */
export type Step = 'worked' | 'idle';
export interface LoopContext {
  readonly config: AgentConfig;
  readonly definitions: AgentDefinitions;
  readonly git: Git;
  readonly state: LoopState;
  /** Строка в консоль и в протокол `.ai-logs/agent-loop-<дата>.md`. */
  readonly say: (line: string) => Promise<void>;
}

const CI_TIMEOUT_MS = 660_000;
/** Пауза после сбоя codex (обычно кончился лимит), мс. */
const RETRY_MS = 30 * 60_000;

export const firstLine = (text: string): string => text.trim().split(/\r?\n/, 1)[0] ?? '';
export const lastLines = (text: string, count = 15): string =>
  text.trim().split(/\r?\n/).slice(-count).join('\n');

export const save = (context: LoopContext): Promise<void> =>
  saveState(context.config.root, context.state);

/**
 * Ожидание владельца: причина печатается один раз, та же причина при том же HEAD
 * больше сессий не запускает. Новый коммит (Issue, pull) снимает ожидание.
 */
export async function park(
  context: LoopContext,
  key: string,
  reason: string,
  answer = '',
): Promise<Step> {
  const current = await head(context.git);
  const { parked } = context.state;
  if (parked?.key === key && parked.head === current) return 'idle';
  context.state.parked = { key, head: current, reason };
  await save(context);
  await context.say(`жду: ${reason}`);
  if (answer.trim() !== '') await context.say(lastLines(answer, 10));
  return 'idle';
}

export async function backoff(context: LoopContext, reason: string, answer: string): Promise<Step> {
  context.state.retryAfter = context.config.now() + RETRY_MS;
  await save(context);
  await context.say(`сбой: ${reason} — следующая попытка через ${minutes(RETRY_MS)}`);
  if (answer.trim() !== '') await context.say(lastLines(answer, 10));
  return 'idle';
}

export async function session(context: LoopContext, role: Role, prompt: string): Promise<Session> {
  const title = firstLine(prompt);
  const started = context.config.now();
  await context.say(`→ ${title} (новая сессия codex)`);
  const result = await runCodex(context.config, context.definitions, role, prompt);
  await context.say(
    `← ${title} за ${minutes(context.config.now() - started)}: ${firstLine(result.message)} (лог ${result.log})`,
  );
  return result;
}

/** Итог CI на HEAD: `unknown` — дождаться не удалось (сеть, таймаут), это не красный CI. */
export interface CiResult {
  readonly verdict: 'green' | 'red' | 'unknown';
  /** Итоговая строка `ci:wait`: ссылка на прогон или причина. */
  readonly line: string;
}

/** Последняя строка итога `ci:wait`; строки pnpm вроде ELIFECYCLE её не заслоняют. */
const ciLine = (stdout: string): string =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(success|failure|error)\b/.test(line))
    .at(-1) ?? lastLines(stdout, 1);

/**
 * Ждёт CI на HEAD силами скрипта. Красный — только упавший job; таймаут и недоступный
 * GitHub повторяются один раз и дают `unknown`. Зелёный HEAD запоминается: ревью его не ждёт.
 */
export async function waitCi(context: LoopContext, label: string): Promise<CiResult> {
  const { config, say, state } = context;
  const started = config.now();
  await say(`… жду CI ${label}`);
  const wait = async (): Promise<CiResult> => {
    const ci = await config.runCommand('pnpm', ['ci:wait'], {
      cwd: config.root,
      timeoutMs: CI_TIMEOUT_MS,
    });
    const line = ciLine(ci.stdout);
    if (ci.code === 0) return { verdict: 'green', line };
    return { verdict: line.startsWith('failure job=') ? 'red' : 'unknown', line };
  };
  let ci = await wait();
  if (ci.verdict === 'unknown') ci = await wait();
  const words = { green: 'зелёный', red: 'красный', unknown: 'не проверен' } as const;
  await say(`CI ${words[ci.verdict]} за ${minutes(config.now() - started)}: ${ci.line}`);
  if (ci.verdict === 'green') {
    state.greenHead = await head(context.git);
    await save(context);
  }
  return ci;
}

export interface StageState {
  readonly stage: string;
  readonly status: string;
  readonly stageText: string;
}

export async function readStage(root: string): Promise<StageState> {
  const status = await readFile(join(root, 'docs/STATUS.md'), 'utf8');
  const stage = status.match(/Текущий этап\s*\|\s*(\d+)/)?.[1];
  if (!stage) throw new Error('В docs/STATUS.md не найден текущий этап');
  const name = (await readdir(join(root, 'docs/stages'))).find((file) =>
    file.startsWith(`stage-${stage}-`),
  );
  if (!name) throw new Error(`Файл этапа ${stage} не найден`);
  return { stage, status, stageText: await readFile(join(root, 'docs/stages', name), 'utf8') };
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
  context: LoopContext,
  base: string,
  allowed: readonly string[],
): Promise<boolean> {
  const { git, config } = context;
  const names = await git.run(['diff', '--name-only', `${base}..HEAD`]);
  const dirty = await dirtyFiles(git);
  const changed = [...names.split(/\r?\n/), ...dirty.split(/\r?\n/).map((line) => line.slice(3))]
    .map((name) => relative(config.root, join(config.root, name.trim())).replaceAll('\\', '/'))
    .filter(Boolean);
  return changed.every((name) => allowed.some((glob) => globToRegExp(glob).test(name)));
}

export type SkillResult =
  | { readonly ok: true; readonly sha: string; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly message: string;
      readonly codexFailed?: boolean;
    };

/**
 * Сессия скилла, который сам коммитит и пушит (`$decide`, `$split`, `$accept`…).
 * Успех — новый коммит, чистое дерево, ветка совпадает с origin, CI зелёный.
 */
export async function runSkill(
  context: LoopContext,
  role: Role,
  prompt: string,
): Promise<SkillResult> {
  const { git } = context;
  const base = await head(git);
  const done = await session(context, role, prompt);
  const fail = (reason: string, extra: { codexFailed?: boolean } = {}): SkillResult => ({
    ok: false,
    reason,
    message: done.message,
    ...extra,
  });
  if (done.failure !== undefined) return fail(done.failure, { codexFailed: true });
  if ((await dirtyFiles(git)) !== '') return fail('после сессии рабочее дерево не чистое');
  if ((await head(git)) === base) return fail('коммита нет — скилл остановился сам (см. ответ)');
  const unsynced = await syncWithOrigin(git, true);
  if (unsynced !== undefined) return fail(unsynced);
  // Коммит скилла уже запушен: CI, который не удалось проверить, проверит ревью следующей задачи.
  const ci = await waitCi(context, `после ${firstLine(prompt).split(/\s/, 1)[0] ?? ''}`);
  if (ci.verdict === 'red') return fail(`CI красный: ${ci.line}`);
  return { ok: true, sha: await head(git), message: done.message };
}

export async function openLog(config: AgentConfig): Promise<(line: string) => Promise<void>> {
  await mkdir(join(config.root, '.ai-logs'), { recursive: true });
  const logPath = join(
    config.root,
    '.ai-logs',
    `agent-loop-${new Date(config.now()).toISOString().slice(0, 10)}.md`,
  );
  return async (line) => {
    config.writeLine(line);
    await appendFile(logPath, `- ${new Date(config.now()).toISOString()} ${line}\n`, 'utf8');
  };
}
