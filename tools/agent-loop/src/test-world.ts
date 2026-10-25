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

/** Реальный reviewer при возврате сохраняет пункты в блоке задачи; фикстура делает то же. */
const appendReviewReturn = (stage: string, task: string, answer: string): string => {
  const items = answer
    .split(/\r?\n/u)
    .slice(1)
    .filter((line) => /^\s*[-*]\s+\S/u.test(line))
    .map((line) => `  ${line.trim()}`);
  if (items.length === 0) return stage;
  const escaped = task.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^- \\[([^\\]]*)\\] \\*\\*${escaped}\\.`, 'mu');
  const start = heading.exec(stage)?.index;
  if (start === undefined) return stage;
  const rest = stage.slice(start + 1);
  const next = /^- \[[ x~]\] \*\*/mu.exec(rest)?.index;
  const end = next === undefined ? stage.length : start + 1 + next;
  const block = `  Возврат ревью:\n${items.join('\n')}\n`;
  return `${stage.slice(0, end).trimEnd()}\n${block}${stage.slice(end)}`;
};

/** Что делает одна сессия codex. Push возможен только при явном `push: true`. */
export interface Session {
  readonly mark?: TaskMark;
  readonly task?: string;
  readonly commit?: boolean;
  readonly push?: boolean;
  /** Файлы последнего коммита (для проверки прав ревью). */
  readonly files?: readonly string[];
  readonly dirty?: boolean | string;
  /** Файлы, которые сессия пишет на диск (путь → текст); при коммите они уходят в HEAD. */
  readonly writes?: Readonly<Record<string, string>>;
  /** Файлы, которые сессия удаляет с диска (путь уходит из `tracked`, при коммите — из HEAD). */
  readonly removes?: readonly string[];
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
  /** Ответы обязательного локального gate перед push; без значения — зелёный. */
  readonly prePush?: readonly string[];
  /** Ответы `pnpm test:e2e:visual` (визуальный гейт перед push); без значения — зелёный. */
  readonly visual?: readonly string[];
  /** Ответы `pnpm test:e2e:layout` (перепроверка repair-$spec при НЕПРОВЕРЯЕМО); без значения — зелёный. */
  readonly layout?: readonly string[];
  /** Ответы локального `pnpm verify --changed` после repair-spec; без значения — зелёный. */
  readonly verify?: readonly string[];
  /** Ответы `ci:wait --workflow=slow.yml`; без значения — зелёный. Код 3 — строка `pending`. */
  readonly slow?: readonly string[];
  /** Ответы eslint по приёмочным тестам по порядку; без значения или `ok` — чисто. */
  readonly lint?: readonly string[];
  /** В roles.json есть роль spec: цикл пишет приёмочные тесты до кода. */
  readonly spec?: boolean;
  /** В roles.json есть отдельный автор тестов после ревью кода. */
  readonly test?: boolean;
  /** В roles.json есть роль plan: цикл проверяет текст задачи перед работой над ней. */
  readonly plan?: boolean;
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
  /** Прямой ответ GitHub по Issue; позволяет моделировать устаревший список. */
  readonly freshIssues?: readonly AgentIssue[];
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
  /**
   * Ответ `git diff -M` от коммита прошлого возврата: включает снимки файла этапа по коммитам для
   * `git show <коммит>:<файл>`; без значения `show` коммита не читается, как раньше.
   */
  readonly reviewDiff?: string;
  /** Ответ `git diff -M --name-status` от коммита прошлого возврата (сторож пропуска пунктов). */
  readonly reviewFiles?: string;
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
  prePushCalls: number;
  visualCalls: number;
  layoutCalls: number;
  /** Число push к моменту каждого запуска pre-push gate. */
  readonly pushesAtPrePush: number[];
  verifyCalls: number;
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
      ...(world.test === true ? { test: { reasoningEffort: 'medium' } } : {}),
      ...(world.plan === true ? { plan: { reasoningEffort: 'medium' } } : {}),
    }),
  );
  await writeFile(
    join(root, 'tools/agent-loop/permissions.json'),
    JSON.stringify({
      reviewer: ['docs/stages/**', 'docs/STATUS.md', 'docs/reports/**'],
      spec: ['**/*.test.ts', '**/*.spec.ts', '**/test/**', '**/tests/**'],
      plan: ['docs/stages/**', 'docs/STATUS.md', 'docs/QUESTIONS.md', 'docs/DECISIONS.md'],
    }),
  );
  const sessions = [...world.sessions];
  const ci = [...(world.ci ?? [])];
  const prePush = [...(world.prePush ?? [])];
  const visual = [...(world.visual ?? [])];
  const layout = [...(world.layout ?? [])];
  const verify = [...(world.verify ?? [])];
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
    prePushCalls: 0,
    visualCalls: 0,
    layoutCalls: 0,
    pushesAtPrePush: [],
    verifyCalls: 0,
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
  let nextCommit = 0;
  let origin = 0;
  const commitDepth = new Map<number, number>([[0, 0]]);
  let dirty =
    world.dirty === true
      ? ' M packages/sim/src/bots/weights.json'
      : world.dirty === undefined || world.dirty === false
        ? ''
        : ` M ${world.dirty}`;
  let files: readonly string[] = [];
  let pushes = 0;
  let squashedFiles: readonly string[] = [];
  // Файлы каждого коммита codex-сессии по номеру HEAD: `git diff --name-only A..B` считает их
  // объединением по диапазону, как настоящий git, а не только файлами последней сессии.
  const commitFiles = new Map<number, readonly string[]>();
  const resolveCommit = (ref: string): number =>
    ref === 'HEAD' ? head : ref.startsWith('origin/') ? origin : commit(ref);
  const unionFiles = (fromCommit: number, toCommit: number): string[] => {
    const set = new Set<string>();
    for (let n = fromCommit + 1; n <= toCommit; n += 1)
      for (const path of commitFiles.get(n) ?? []) set.add(path);
    return [...set];
  };
  // Файл этапа на каждом коммите: повторное ревью сравнивает текст задачи с коммитом возврата.
  const snapshots = new Map<number, string>([[0, await readFile(stagePath, 'utf8')]]);
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
    if (env?.AGENT_ROLE !== 'reviewer' && session.mark && session.task)
      await writeFile(
        stagePath,
        setMark(await readFile(stagePath, 'utf8'), session.task, session.mark),
      );
    if (
      env?.AGENT_ROLE !== 'reviewer' &&
      session.mark === ' ' &&
      session.task &&
      session.stage === undefined
    )
      await writeFile(
        stagePath,
        appendReviewReturn(await readFile(stagePath, 'utf8'), session.task, session.answer),
      );
    if (session.stage !== undefined) await writeFile(stagePath, session.stage);
    if (session.status !== undefined) await writeFile(statusPath, session.status);
    if (session.branch !== undefined) branch = session.branch;
    for (const [path, text] of Object.entries(session.writes ?? {})) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
      tracked.add(path);
    }
    for (const path of session.removes ?? []) {
      await rm(join(root, path), { force: true });
      tracked.delete(path);
    }
    const changed =
      env?.AGENT_ROLE !== 'reviewer' &&
      (session.mark !== undefined || session.stage !== undefined || session.status !== undefined);
    const committing = session.commit ?? changed;
    if (committing) {
      const parent = head;
      head = ++nextCommit;
      commitDepth.set(head, (commitDepth.get(parent) ?? 0) + 1);
      snapshots.set(head, await readFile(stagePath, 'utf8'));
      for (const path of tracked) {
        const text = await readFile(join(root, path), 'utf8').catch(() => undefined);
        if (text === undefined) committed.delete(path);
        else committed.set(path, text);
      }
      for (const path of session.removes ?? []) committed.delete(path);
    }
    if (session.push === true) origin = head;
    files = session.files ?? [
      ...(env?.AGENT_ROLE !== 'reviewer' &&
      (session.mark !== undefined || session.stage !== undefined)
        ? ['docs/stages/stage-06-bots-balance.md']
        : []),
      ...Object.keys(session.writes ?? {}),
      ...(session.removes ?? []),
    ];
    if (committing) commitFiles.set(head, files);
    dirty =
      typeof session.dirty === 'string'
        ? session.dirty
        : session.dirty === true
          ? ' M packages/sim/src/step.ts'
          : '';
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
    const snapshot = /^c(\d+):docs\/stages\//u.exec(first ?? '');
    if (sub === 'show' && snapshot !== null && world.reviewDiff !== undefined) {
      const text = snapshots.get(Number(snapshot[1]));
      return text === undefined ? { code: 128, stdout: '', stderr: 'нет коммита' } : ok(text);
    }
    if (sub === 'diff' && args.includes('--name-status')) {
      if (world.reviewFiles !== undefined) return ok(world.reviewFiles);
      const [fromRef, toRef] = (args[2] ?? '').split('..');
      if (fromRef === undefined || toRef === undefined) return ok('');
      return ok(
        unionFiles(resolveCommit(fromRef), resolveCommit(toRef))
          .map((path) => `M\t${path}`)
          .join('\n'),
      );
    }
    if (sub === 'diff' && first === '--name-only') {
      const [fromRef, toRef] = (args[2] ?? '').split('..');
      return ok(
        fromRef !== undefined && toRef !== undefined
          ? unionFiles(resolveCommit(fromRef), resolveCommit(toRef)).join('\n')
          : files.join('\n'),
      );
    }
    if (sub === 'diff' && args.includes('--cached')) return ok();
    if (sub === 'diff' && first === '-M') return ok(world.reviewDiff ?? '');
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
    if (sub === 'rev-list' && first === '--count') {
      const [fromRef, toRef] = (args[2] ?? '').split('..');
      return ok(
        String(
          fromRef !== undefined && toRef !== undefined
            ? (commitDepth.get(resolveCommit(toRef)) ?? 0) -
                (commitDepth.get(resolveCommit(fromRef)) ?? 0)
            : 0,
        ),
      );
    }
    if (sub === 'rev-parse')
      return ok(`c${first?.startsWith('origin/') ? origin : first === 'HEAD^' ? head - 1 : head}`);
    if (sub === 'diff' && first === '--quiet')
      return { ...ok(), code: world.merged === true ? 0 : 1 };
    if (sub === 'diff') return ok(files.join('\n'));
    if (sub === 'push') {
      pushes += 1;
      origin = head;
      return ok();
    }
    if (sub === 'add') return ok();
    if (sub === 'reset' && first === '--soft') {
      const target = resolveCommit(args[2] ?? 'HEAD');
      squashedFiles = unionFiles(target, head);
      head = target;
      return ok();
    }
    if (sub === 'checkout' && args.includes('--')) {
      const paths = args.slice(args.indexOf('--') + 1);
      for (const path of paths) {
        const saved = committed.get(path);
        if (saved !== undefined) await writeFile(join(root, path), saved);
      }
      return ok();
    }
    if (sub === 'clean' && args.includes('-f')) {
      const dashIndex = args.indexOf('--');
      const paths = dashIndex >= 0 ? args.slice(dashIndex + 1) : [];
      for (const path of paths) {
        if (committed.has(path)) continue;
        tracked.delete(path);
        await rm(join(root, path), { force: true });
      }
      return ok();
    }
    if (sub === 'commit') {
      const parent = head;
      head = ++nextCommit;
      commitDepth.set(head, (commitDepth.get(parent) ?? 0) + 1);
      snapshots.set(head, await readFile(stagePath, 'utf8'));
      for (const path of tracked) {
        const text = await readFile(join(root, path), 'utf8').catch(() => undefined);
        if (text === undefined) committed.delete(path);
        else committed.set(path, text);
      }
      dirty = '';
      if (squashedFiles.length > 0) {
        commitFiles.set(head, squashedFiles);
        files = squashedFiles;
        squashedFiles = [];
      }
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
        out.closed.includes(number)
          ? undefined
          : (world.freshIssues ?? issues).find((item) => item.number === number),
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
        if (command === 'pnpm' && args[0] === 'verify:prepush') {
          out.prePushCalls += 1;
          out.pushesAtPrePush.push(pushes);
          const line = prePush.shift() ?? 'pre-push: OK';
          return { code: line.startsWith('pre-push: OK') ? 0 : 1, stdout: line, stderr: '' };
        }
        if (command === 'pnpm' && args[0] === 'test:e2e:visual') {
          out.visualCalls += 1;
          const line = visual.shift() ?? 'visual: OK';
          return { code: line.startsWith('visual: OK') ? 0 : 1, stdout: line, stderr: '' };
        }
        if (command === 'pnpm' && args[0] === 'test:e2e:layout') {
          out.layoutCalls += 1;
          const line = layout.shift() ?? 'layout: OK';
          return { code: line.startsWith('layout: OK') ? 0 : 1, stdout: line, stderr: '' };
        }
        if (command === 'pnpm' && args[0] === 'verify') {
          out.verifyCalls += 1;
          const line = verify.shift() ?? 'verify: OK';
          return { code: line.startsWith('verify: OK') ? 0 : 1, stdout: line, stderr: '' };
        }
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
