// Общее для шагов цикла: настройки, протокол, ожидание владельца, сессия скилла с проверками.
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { MAIN_AGENT, type Board } from './board.ts';
import { minutes, runCodex, type AgentDefinitions, type Role, type Session } from './codex.ts';
import { changedPaths, dirtyFiles, head, syncWithOrigin, type Git } from './git.ts';
import type { GithubClient } from './github.ts';
import { waitActions } from './owner-actions.ts';
import type { RunCommand } from './process.ts';
import { saveState, type LoopState } from './state.ts';

export interface AgentConfig {
  readonly root: string;
  readonly maxRounds: number;
  /**
   * `--streams N`: предел параллельных задач, запоминается в памяти цикла. Не задан — прежний
   * предел из памяти (Issue `$streams N`), по умолчанию 1 — цикл по одной задаче в главном каталоге.
   */
  readonly streams?: number;
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
  /** Переменные окружения сессий Codex сверх `process.env`. */
  readonly env?: Readonly<Record<string, string>>;
  /** Панель консоли; без неё (тесты, вывод не в терминал) — только строки протокола. */
  readonly board?: Board;
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
  /** Задача идёт в параллельном потоке: свой каталог (worktree) и своя ветка. */
  readonly stream?: StreamInfo;
}
export interface StreamInfo {
  /** Имя потока в протоколе: `w1`. */
  readonly name: string;
  readonly task: string;
  /** Ветка задачи: `agent/07-T2`. */
  readonly branch: string;
  /** Причина отмены (текст задачи изменился); undefined — работать дальше. */
  readonly cancelled: () => string | undefined;
}

/** Поток отменён между сессиями: его ветка отбрасывается, задача начнётся заново. */
export class StreamCancelled extends Error {}

/** Строка запроса сессии потока: скиллы сверяют ветку с ней, а не с «Веткой» STATUS. */
export const streamNote = (stream: StreamInfo): string =>
  `Поток ${stream.name}: ветка ${stream.branch} вместо ветки этапа из STATUS. docs/STATUS.md не меняй; push — ветки ${stream.branch}.`;

const CI_TIMEOUT_MS = 660_000;
/** Пауза после сбоя codex (обычно кончился лимит), мс. */
const RETRY_MS = 30 * 60_000;

/**
 * Ожидания, которые снимаются сами, без нового коммита: их проверка повторяется каждый шаг.
 * Красный `slow` — тоже: прогон, перезапущенный на GitHub, зеленеет на том же HEAD.
 */
export const selfClearing = (key: string): boolean => /^(dirty|branch|sync|slow:.+)$/u.test(key);

/** Имя агента на панели: поток `wN` или главный каталог. */
export const agentName = (context: LoopContext): string => context.stream?.name ?? MAIN_AGENT;

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
  // Ожидание владельца — не оборванная сессия: незакоммиченное дерево ждёт его, а не доделки
  // на каждом шаге цикла.
  const resumed = context.state.resume !== undefined;
  delete context.state.resume;
  if (parked?.key === key && parked.head === current) {
    if (resumed) await save(context);
    return 'idle';
  }
  context.state.parked = { key, head: current, reason };
  await save(context);
  context.config.board?.wait(
    agentName(context),
    reason,
    waitActions(key, reason, selfClearing(key), context.config.github?.repo),
  );
  await context.say(`жду: ${reason}`);
  if (answer.trim() !== '') await context.say(lastLines(answer, 10));
  return 'idle';
}

/**
 * Ожидание, которое снялось само (дерево чистое, ветка верная, `slow` не красный): строка агента
 * больше не зовёт владельца. В режиме потоков главный агент иначе так и висел бы в баннере,
 * а клавиши ответа доставались бы ему, а не потоку с настоящим вопросом.
 */
export async function settleWait(
  context: LoopContext,
  cleared: (key: string) => boolean,
): Promise<void> {
  const key = context.state.parked?.key;
  if (key === undefined || !selfClearing(key) || !cleared(key)) return;
  delete context.state.parked;
  await save(context);
  context.config.board?.end(agentName(context), 'ожидание снялось само');
  await context.say(`ожидание снялось само: ${key}`);
}

export async function backoff(context: LoopContext, reason: string, answer: string): Promise<Step> {
  context.state.retryAfter = context.config.now() + RETRY_MS;
  await save(context);
  context.config.board?.pause(agentName(context), `${reason} — повтор через ${minutes(RETRY_MS)}`);
  await context.say(`сбой: ${reason} — следующая попытка через ${minutes(RETRY_MS)}`);
  if (answer.trim() !== '') await context.say(lastLines(answer, 10));
  return 'idle';
}

/** Пауза после сбоя кончилась: шаг повторяется, а экран больше не показывает паузу. */
export async function endPause(context: LoopContext): Promise<void> {
  delete context.state.retryAfter;
  await save(context);
  context.config.board?.end(agentName(context), 'пауза кончилась — повторяю');
}

export async function session(
  context: LoopContext,
  role: Role,
  prompt: string,
  locked: readonly string[] = [],
): Promise<Session> {
  const title = firstLine(prompt);
  const { stream } = context;
  const cancelled = stream?.cancelled();
  if (cancelled !== undefined) throw new StreamCancelled(cancelled);
  const { board } = context.config;
  const started = context.config.now();
  board?.begin(agentName(context), title);
  await context.say(`→ ${title} (новая сессия codex)`);
  const full = stream === undefined ? prompt : `${prompt}\n${streamNote(stream)}`;
  const result = await runCodex(context.config, context.definitions, role, full, locked);
  board?.count('sessions');
  board?.count('sessionMs', context.config.now() - started);
  board?.end(
    agentName(context),
    `${title}: ${firstLine(result.message)}`,
    result.log,
    join(context.config.root, result.log),
  );
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
 * GitHub повторяются один раз и дают `unknown`.
 * @param allWorkflows и остальные workflow HEAD, кроме `slow` (перед ревью и слиянием задачи):
 *   только такой зелёный HEAD запоминается, и ревью его не ждёт. Коммит `$bug`/`$decide` их
 *   не ждёт: workflow, сломанный задачей, не должен останавливать запись бага о нём.
 */
export async function waitCi(
  context: LoopContext,
  label: string,
  allWorkflows = false,
): Promise<CiResult> {
  const { config, say, state } = context;
  const started = config.now();
  config.board?.begin(agentName(context), `CI ${label}`);
  await say(`… жду CI ${label}`);
  const args = allWorkflows ? ['--all-workflows'] : [];
  let ci = await ciWait(context, args, CI_TIMEOUT_MS);
  if (ci.verdict === 'unknown') ci = await ciWait(context, args, CI_TIMEOUT_MS);
  countCi(context, `CI ${label}`, ci);
  await say(`CI ${CI_WORDS[ci.verdict]} за ${minutes(config.now() - started)}: ${ci.line}`);
  if (ci.verdict === 'green' && allWorkflows) {
    state.greenHead = await head(context.git);
    await save(context);
  }
  return ci;
}

const CI_WORDS = { green: 'зелёный', red: 'красный', unknown: 'не проверен' } as const;

function countCi(context: LoopContext, title: string, ci: CiResult): void {
  const { board } = context.config;
  if (ci.verdict === 'green') board?.count('ciGreen');
  if (ci.verdict === 'red') board?.count('ciRed');
  board?.end(agentName(context), `${title}: ${CI_WORDS[ci.verdict]}`);
}
/** Прогон всех тестов идёт дольше быстрого CI: random-match один — 4–5 мин. */
const SLOW_TIMEOUT_MS = 25 * 60_000;
const SLOW_ARGS = ['--workflow=slow.yml'];

async function ciWait(
  context: LoopContext,
  args: readonly string[],
  timeoutMs: number,
): Promise<CiResult & { readonly pending: boolean }> {
  const { config } = context;
  const ci = await config.runCommand('pnpm', ['ci:wait', ...args], { cwd: config.root, timeoutMs });
  const line = ciLine(ci.stdout);
  if (ci.code === 0) return { verdict: 'green', line, pending: false };
  // Код 3 — `--once`: прогон ещё идёт. Это не красный CI и не сбой.
  if (ci.code === 3) return { verdict: 'unknown', line, pending: true };
  return { verdict: line.startsWith('failure job=') ? 'red' : 'unknown', line, pending: false };
}

/**
 * Workflow `slow` (все тесты) на HEAD одним опросом, без ожидания: цикл его не ждёт перед
 * ревью. Зелёный HEAD запоминается, чтобы не спрашивать GitHub на каждом шаге.
 */
export async function pollSlow(context: LoopContext): Promise<CiResult> {
  const current = await head(context.git);
  if (context.state.slowGreen === current) return { verdict: 'green', line: '' };
  const ci = await ciWait(context, [...SLOW_ARGS, '--once'], CI_TIMEOUT_MS);
  if (ci.verdict === 'green') {
    context.state.slowGreen = current;
    await save(context);
  }
  return { verdict: ci.verdict, line: ci.line };
}

/** Ждёт `slow` на HEAD до конца: перед `$stage-close` этап закрывается только на зелёном. */
export async function waitSlow(context: LoopContext, label: string): Promise<CiResult> {
  const { config, say } = context;
  const started = config.now();
  config.board?.begin(agentName(context), `slow ${label}`);
  await say(`… жду slow ${label}`);
  const ci = await ciWait(
    context,
    [...SLOW_ARGS, `--timeout-minutes=${SLOW_TIMEOUT_MS / 60_000}`],
    SLOW_TIMEOUT_MS + 60_000,
  );
  countCi(context, `slow ${label}`, ci);
  await say(`slow ${CI_WORDS[ci.verdict]} за ${minutes(config.now() - started)}: ${ci.line}`);
  if (ci.verdict === 'green') {
    context.state.slowGreen = await head(context.git);
    await save(context);
  }
  return { verdict: ci.verdict, line: ci.line };
}

export interface StageState {
  readonly stage: string;
  /** Файл этапа от корня репозитория: `docs/stages/stage-07-….md`. */
  readonly path: string;
  readonly status: string;
  readonly stageText: string;
}

/** Чем цикл читает STATUS: строки таблицы из шаблона скилла `$stage-close`. */
export const STATUS_FORMAT =
  'в docs/STATUS.md нужны строки таблицы «| Текущий этап | NN — название |» и «| Ветка | `stage-NN` |» (шаблон — скилл $stage-close)';

export const readStatus = (root: string): Promise<string> =>
  readFile(join(root, 'docs/STATUS.md'), 'utf8');

export async function readStage(root: string): Promise<StageState> {
  const status = await readStatus(root);
  const stage = status.match(/Текущий этап\s*\|\s*(\d+)/)?.[1];
  if (!stage) throw new Error(`не найден текущий этап: ${STATUS_FORMAT}`);
  const name = (await readdir(join(root, 'docs/stages'))).find((file) =>
    file.startsWith(`stage-${stage}-`),
  );
  if (!name) throw new Error(`Файл этапа ${stage} не найден`);
  const path = `docs/stages/${name}`;
  return { stage, path, status, stageText: await readFile(join(root, path), 'utf8') };
}

// Glob путей прав: `*` — внутри каталога, `**` — через каталоги, `**` со слешем — и без каталога.
export const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '__ANY_DIRS__')
      .replace(/\*\*/g, '__DOUBLE_STAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__ANY_DIRS__/g, '(?:.*/)?')
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
  // Пути по одному на файл: `git run` обрезает пробел первой строки porcelain, slice(3) там врал.
  const changed = [...names.split(/\r?\n/), ...(await changedPaths(git))]
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
  if (config.board !== undefined) config.board.loopLog = relative(config.root, logPath);
  return async (line) => {
    config.writeLine(line);
    await appendFile(logPath, `- ${new Date(config.now()).toISOString()} ${line}\n`, 'utf8');
  };
}
