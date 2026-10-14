// Подменный мир для тестов цикла: git, codex, ci:wait и GitHub в памяти, файлы этапа во временной папке.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runAgentLoop, type CommandResult } from './agent-loop.ts';
import type { Board } from './board.ts';
import type { AgentIssue, GithubClient } from './github.ts';
import type { TaskMark } from './stage-file.ts';
import { loadState, saveState, type LoopState } from './state.ts';

export const fixtureStatus = `# Статус

| Текущий этап | 06 — тестовый этап |
| Ветка | \`stage-06\` |

Очередь: 06/T1j5-Б1 → 06/T1i → 06/T1e
`;
export const fixtureStage = `# Этап 06

- [ ] **T1. Родитель**, не задача владельца.
- [ ] **T1i. Обучение весов**, задача владельца. Владелец запускает \`pnpm evolve\`.
- [ ] **T1e. Проверка родителя T1**, сквозная проверка, не задача владельца.
  *Приёмка:* отмечается \`[x]\` только после пройденного \`$accept 06/T1\`.
- [ ] **T1j5-Б1. Фитнес по метрикам самой особи** (tools/evolve).
  *Приёмка:* тесты.
- [ ] **T2. Итерации баланса**.
`;

export const setMark = (stage: string, task: string, mark: TaskMark): string =>
  stage.replace(new RegExp(`^- \\[[^\\]]\\] \\*\\*${task}\\.`, 'm'), `- [${mark}] **${task}.`);
export const closeAll = (stage: string): string => stage.replaceAll(/^- \[[ ~]\]/gm, '- [x]');

/** Что делает одна сессия codex. По умолчанию — коммит и push, если менялась отметка или файлы. */
export interface Session {
  readonly mark?: TaskMark;
  readonly task?: string;
  readonly commit?: boolean;
  readonly push?: boolean;
  /** Файлы последнего коммита (для проверки прав ревью). */
  readonly files?: readonly string[];
  readonly dirty?: boolean;
  /** Файлы, которые сессия пишет на диск (путь → текст); при коммите они уходят в HEAD. */
  readonly writes?: Readonly<Record<string, string>>;
  readonly status?: string;
  readonly stage?: string;
  /** Сессия переключила ветку (шаг 7 `$stage-close`). */
  readonly branch?: string;
  readonly answer: string;
  readonly code?: number;
}

export interface World {
  readonly sessions: readonly Session[];
  readonly ci?: readonly string[];
  /** Ответы `ci:wait --workflow=slow.yml`; без значения — зелёный. Код 3 — строка `pending`. */
  readonly slow?: readonly string[];
  /** Ответы eslint по приёмочным тестам по порядку; без значения или `ok` — чисто. */
  readonly lint?: readonly string[];
  /** В roles.json есть роль spec: цикл пишет приёмочные тесты до кода. */
  readonly spec?: boolean;
  /** Память прошлого запуска цикла (`state.json`). */
  readonly state?: Partial<LoopState>;
  /** Панель консоли: что агенты делают, счётчики, клавиши владельца. */
  readonly board?: Board;
  /** Трейлер `Этап:` коммита HEAD. */
  readonly headTrailer?: string;
  readonly status?: string;
  readonly stage?: string;
  readonly maxRounds?: number;
  readonly dryRun?: boolean;
  readonly branch?: string;
  /** Незакоммиченный файл на старте: true — веса владельца, строка — этот путь. */
  readonly dirty?: boolean | string;
  readonly resume?: string;
  readonly issues?: readonly AgentIssue[];
  /** Ветка этапа уже смёржена в main. */
  readonly merged?: boolean;
  /** Сколько раз дать циклу поспать до выхода; без значения — режим `--once`. */
  readonly polls?: number;
  /** Issue, которая появится во время ожидания: её увидит дешёвая проверка `changed`. */
  readonly arrival?: AgentIssue;
  /** Каждая пауза кончается Enter владельца: следующий полный шаг сразу. */
  readonly wake?: boolean;
  /**
   * Список Issues GitHub отстаёт: отдаёт Issues открытыми и без новых меток. `true` — в прежнем
   * виде; `bumped` — с новым `updated_at` от ответа цикла, как список GitHub 2026-10-14.
   */
  readonly staleList?: boolean | 'bumped';
}

export interface Outcome {
  code: number;
  readonly prompts: string[];
  readonly roles: (string | undefined)[];
  /** `AGENT_LOCKED` каждой сессии codex. */
  readonly locked: string[];
  readonly codexArguments: (readonly string[])[];
  readonly lines: string[];
  readonly comments: string[];
  readonly closed: number[];
  readonly labels: string[];
  readonly pulls: string[];
  pushes: number;
  ciCalls: number;
  /** Вызовы `pnpm exec` (eslint, prettier) с аргументами. */
  readonly execs: string[];
  /** Вызовы `ci:wait` для workflow `slow` с аргументами. */
  readonly slowCalls: string[];
  /** Прогоны, перезапущенные циклом через GitHub. */
  readonly reruns: number[];
  /** Аргументы `ci:wait` быстрого CI по вызовам: `--all-workflows` — с остальными workflow. */
  readonly ciArgs: string[];
  sleeps: number;
  checks: number;
  /** Сколько пауз прошло к началу каждой сессии codex. */
  readonly sleepsAtPrompt: number[];
  /** `push` и `pop` git stash по порядку. */
  readonly stashes: string[];
}

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });

export async function runWorld(world: World): Promise<Outcome> {
  const root = await mkdtemp(join(tmpdir(), 'hexfront-agent-loop-test-'));
  const stagePath = join(root, 'docs/stages/stage-06-bots-balance.md');
  const statusPath = join(root, 'docs/STATUS.md');
  await mkdir(join(root, 'docs/stages'), { recursive: true });
  await mkdir(join(root, 'tools/agent-loop'), { recursive: true });
  await writeFile(statusPath, world.status ?? fixtureStatus, 'utf8');
  await writeFile(stagePath, world.stage ?? fixtureStage, 'utf8');
  if (world.state !== undefined)
    await saveState(root, { ...(await loadState(root)), ...world.state });
  await writeFile(
    join(root, 'docs/stages/stage-07-next.md'),
    '# Этап 07\n\n- [ ] **T1. Первая**\n',
  );
  await writeFile(
    join(root, 'tools/agent-loop/roles.json'),
    JSON.stringify({
      next: { model: 'luna', reasoningEffort: 'medium' },
      review: { reasoningEffort: 'medium' },
      ...(world.spec === true ? { spec: { reasoningEffort: 'medium' } } : {}),
    }),
  );
  await writeFile(
    join(root, 'tools/agent-loop/permissions.json'),
    JSON.stringify({
      reviewer: ['docs/stages/**', 'docs/STATUS.md', 'docs/reports/**'],
      spec: ['**/*.test.ts', '**/test/**'],
    }),
  );
  const sessions = [...world.sessions];
  const ci = [...(world.ci ?? [])];
  const slow = [...(world.slow ?? [])];
  const lint = [...(world.lint ?? [])];
  const issues = [...(world.issues ?? [])];
  const out: Outcome = {
    code: 0,
    prompts: [],
    roles: [],
    locked: [],
    codexArguments: [],
    lines: [],
    comments: [],
    closed: [],
    labels: [],
    pulls: [],
    pushes: 0,
    ciCalls: 0,
    slowCalls: [],
    reruns: [],
    ciArgs: [],
    execs: [],
    sleeps: 0,
    checks: 0,
    sleepsAtPrompt: [],
    stashes: [],
  };
  let branch = world.branch ?? 'stage-06';
  let head = 0;
  let origin = 0;
  let dirty =
    world.dirty === true
      ? ' M packages/sim/src/bots/weights.json'
      : world.dirty === undefined || world.dirty === false
        ? ''
        : ` M ${world.dirty}`;
  let files: readonly string[] = [];
  let pushes = 0;
  // Файлы сессий вне файлов этапа: что лежит на диске и что закоммичено в HEAD.
  const tracked = new Set<string>();
  const committed = new Map<string, string>();
  const fileStatus = async (): Promise<string[]> => {
    const lines: string[] = [];
    for (const path of tracked) {
      const text = await readFile(join(root, path), 'utf8').catch(() => undefined);
      const saved = committed.get(path);
      if (text === saved) continue;
      lines.push(`${saved === undefined ? '??' : text === undefined ? ' D' : ' M'} ${path}`);
    }
    return lines;
  };
  const commit = (number: string): number => Number(number.replace(/^c/, ''));
  const codex = async (
    input: string,
    env: NodeJS.ProcessEnv | undefined,
    args: readonly string[],
  ) => {
    out.prompts.push(input);
    out.sleepsAtPrompt.push(out.sleeps);
    out.roles.push(env?.AGENT_ROLE);
    out.locked.push(env?.AGENT_LOCKED ?? '');
    out.codexArguments.push(args);
    const session = sessions.shift();
    if (!session) throw new Error(`лишний вызов codex: ${input}`);
    if (session.mark && session.task)
      await writeFile(
        stagePath,
        setMark(await readFile(stagePath, 'utf8'), session.task, session.mark),
      );
    if (session.stage !== undefined) await writeFile(stagePath, session.stage);
    if (session.status !== undefined) await writeFile(statusPath, session.status);
    if (session.branch !== undefined) branch = session.branch;
    for (const [path, text] of Object.entries(session.writes ?? {})) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
      tracked.add(path);
    }
    const changed =
      session.mark !== undefined || session.stage !== undefined || session.status !== undefined;
    if (session.commit ?? changed) {
      head += 1;
      for (const path of tracked) {
        const text = await readFile(join(root, path), 'utf8').catch(() => undefined);
        if (text === undefined) committed.delete(path);
        else committed.set(path, text);
      }
    }
    if (session.push !== false) origin = head;
    files = session.files ?? ['docs/stages/stage-06-bots-balance.md'];
    dirty = session.dirty === true ? ' M packages/sim/src/step.ts' : '';
    return { code: session.code ?? 0, stdout: session.answer, stderr: '' };
  };
  // git stash: отложенная на время Issue владельца работа (только незакоммиченные строки `dirty`).
  let shelf: { readonly dirty: string; readonly message: string } | undefined;
  const stash = (args: readonly string[]): CommandResult => {
    const [, action] = args;
    if (action === 'push') {
      shelf = { dirty, message: args.at(-1) ?? '' };
      dirty = '';
      out.stashes.push('push');
      return ok();
    }
    if (action === 'list') return ok(shelf ? `stash@{0}\tOn ${branch}: ${shelf.message}` : '');
    if (action === 'pop' && shelf) {
      dirty = shelf.dirty;
      shelf = undefined;
      out.stashes.push('pop');
      return ok();
    }
    throw new Error(`неожиданная команда git ${args.join(' ')}`);
  };
  const git = async (args: readonly string[]): Promise<CommandResult> => {
    const [sub, first] = args;
    if (sub === 'stash') return stash(args);
    if (sub === 'diff' && args.includes('--diff-filter=U')) return ok();
    if (sub === 'branch') return ok(branch);
    if (sub === 'status') return ok([dirty, ...(await fileStatus())].filter(Boolean).join('\n'));
    if (sub === 'show') {
      const text = committed.get(first?.replace(/^HEAD:/, '') ?? '');
      return text === undefined ? { code: 128, stdout: '', stderr: 'нет в HEAD' } : ok(text);
    }
    if (sub === 'fetch' || sub === 'merge' || sub === 'rebase') {
      if (sub !== 'fetch') head = Math.max(head, origin);
      return ok();
    }
    if (sub === 'remote') return ok('https://github.com/detektor133/HexFront.git');
    if (sub === 'log') return ok(world.headTrailer ?? '');
    if (sub === 'rev-parse') return ok(`c${first?.startsWith('origin/') ? origin : head}`);
    if (sub === 'diff' && first === '--quiet')
      return { ...ok(), code: world.merged === true ? 0 : 1 };
    if (sub === 'diff') return ok(files.join('\n'));
    if (sub === 'push') {
      pushes += 1;
      origin = head;
      return ok();
    }
    if (sub === 'merge-base') {
      const [, , ancestor = '', descendant = ''] = args;
      if (descendant === 'origin/main') return { ...ok(), code: world.merged === true ? 0 : 1 };
      const resolve = (ref: string) => (ref.startsWith('origin/') ? origin : commit(ref));
      return { ...ok(), code: resolve(ancestor) <= resolve(descendant) ? 0 : 1 };
    }
    throw new Error(`неожиданная команда git ${args.join(' ')}`);
  };
  const github: GithubClient = {
    repo: 'detektor133/HexFront',
    owner: 'detektor133',
    listIssues: () =>
      Promise.resolve(
        world.staleList === undefined || world.staleList === false
          ? issues.filter((issue) => !out.closed.includes(issue.number))
          : (world.issues ?? []).map((issue) =>
              world.staleList === 'bumped' &&
              out.comments.some((c) => c.startsWith(`#${issue.number}:`))
                ? { ...issue, updatedAt: '2026-10-13T02:00:00Z' }
                : issue,
            ),
      ),
    openIssue: (number) =>
      Promise.resolve(
        out.closed.includes(number) ? undefined : issues.find((item) => item.number === number),
      ),
    comment: (issue, body) => {
      out.comments.push(`#${issue}: ${body}`);
      return Promise.resolve();
    },
    close: (issue) => {
      out.closed.push(issue);
      return Promise.resolve();
    },
    addLabel: (issue, label) => {
      out.labels.push(`#${issue}: ${label}`);
      const found = issues.findIndex((item) => item.number === issue);
      const item = issues[found];
      if (item) issues[found] = { ...item, labels: [...item.labels, label] };
      return Promise.resolve();
    },
    changed: () => {
      out.checks += 1;
      // Первый вызов в ожидании только запоминает состояние; Issue приходит ко второй проверке.
      if (world.arrival === undefined || out.checks < 2 || issues.includes(world.arrival))
        return Promise.resolve(false);
      issues.push(world.arrival);
      return Promise.resolve(true);
    },
    openPullRequest: (head_, base) => {
      out.pulls.push(`${head_} → ${base}`);
      return Promise.resolve('https://github.com/detektor133/HexFront/pull/7');
    },
    rerunFailedJobs: (runId) => {
      out.reruns.push(runId);
      return Promise.resolve();
    },
  };
  let polls = world.polls ?? 0;
  try {
    out.code = await runAgentLoop({
      root,
      maxRounds: world.maxRounds ?? 3,
      maxMinutes: 10,
      pollSeconds: 30,
      pollMinutes: 10,
      once: world.polls === undefined,
      dryRun: world.dryRun ?? false,
      ...(world.resume === undefined ? {} : { resume: world.resume }),
      github,
      runCommand: async (command, args, options) => {
        if (command === 'pnpm' && args.includes('--workflow=slow.yml')) {
          out.slowCalls.push(args.slice(1).join(' '));
          const line = slow.shift() ?? 'success https://slow/1';
          const code = line.startsWith('success') ? 0 : line.startsWith('pending') ? 3 : 1;
          return { code, stdout: line, stderr: '' };
        }
        if (command === 'pnpm' && args[0] === 'exec') {
          out.execs.push(args.slice(1).join(' '));
          const line = args[1] === 'eslint' ? (lint.shift() ?? 'ok') : 'ok';
          return { code: line === 'ok' ? 0 : 1, stdout: line, stderr: '' };
        }
        if (command === 'pnpm') {
          out.ciCalls += 1;
          out.ciArgs.push(args.slice(1).join(' '));
          const line = ci.shift() ?? 'success https://ci/1';
          return { code: line.startsWith('success') ? 0 : 1, stdout: line, stderr: '' };
        }
        if (command === 'codex') return codex(options?.input ?? '', options?.env, args);
        return git(args);
      },
      now: (() => {
        let time = 0;
        return () => (time += 1);
      })(),
      sleep: () => {
        polls -= 1;
        if (polls < 0) throw new Error('конец теста');
        out.sleeps += 1;
        return Promise.resolve(world.wake === true ? ('wake' as const) : ('timer' as const));
      },
      writeLine: (line) => out.lines.push(line),
      ...(world.board === undefined ? {} : { board: world.board }),
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === 'конец теста')) throw error;
  } finally {
    out.pushes = pushes;
    await rm(root, { recursive: true, force: true });
  }
  return out;
}

export const issue = (number: number, body: string, author = 'detektor133'): AgentIssue => ({
  number,
  title: `Issue ${number}`,
  body,
  author,
  labels: ['agent'],
  updatedAt: '2026-10-13T01:00:00Z',
});
