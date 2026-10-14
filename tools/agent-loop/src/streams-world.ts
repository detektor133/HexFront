// Мир для тестов потоков на настоящем git: origin — голый репозиторий, главный каталог — клон,
// каталоги потоков — настоящие worktree. Подменены только codex, CI и GitHub.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runAgentLoop } from './agent-loop.ts';
import type { AgentIssue, GithubClient } from './github.ts';
import {
  defaultRunCommand,
  prepareProcessArguments,
  type CommandResult,
  type RunCommand,
} from './process.ts';
import type { TaskMark } from './stage-file.ts';

// На Windows команда идёт через cmd: пути временных папок с пробелом нужно взять в кавычки.
const realRun: RunCommand = (command, args, options) =>
  defaultRunCommand(command, prepareProcessArguments(args), options);

export const STAGE_FILE = 'docs/stages/stage-07-test.md';

export interface TaskBehaviour {
  /** Файлы, которые пишет работа задачи (путь → текст); по умолчанию `src/<задача>.txt`. */
  readonly writes?: Readonly<Record<string, string>>;
  /** Сколько мс идёт сессия работы: так потоки реально пересекаются во времени. */
  readonly workMs?: number;
  /** Ответы ревью по порядку; дальше — OK. */
  readonly reviews?: readonly ('OK' | 'ВОЗВРАТ')[];
  /** Сколько первых сессий работы падают с кодом 1, оставляя файлы незакоммиченными. */
  readonly crashes?: number;
  /** Сколько первых сессий работы останавливаются с вопросом владельцу, ничего не меняя. */
  readonly asks?: number;
}

export interface StreamsWorld {
  readonly queue: string;
  readonly stage: string;
  readonly tasks: Readonly<Record<string, TaskBehaviour>>;
  readonly streams?: number;
  /** Вердикты CI по порядку вызовов `ci:wait` (кроме slow); дальше — зелёный. */
  readonly ci?: readonly ('success' | 'failure')[];
  /** Issue, которая появится на N-м чтении списка Issues, и что её `$decide` пишет в файл этапа. */
  readonly decide?: { readonly atList: number; readonly stage: (text: string) => string };
  /** Issues-настройки (`$streams N`), каждая появляется на своём N-м чтении списка Issues. */
  readonly commands?: readonly { readonly atList: number; readonly body: string }[];
}

export interface StreamsRun {
  code: number;
  readonly prompts: { readonly prompt: string; readonly cwd: string }[];
  /** События `start:<промпт>`/`end:<промпт>` сессий codex в порядке времени. */
  readonly events: string[];
  readonly lines: string[];
  /** Вызовы CI по порядку: sha. */
  readonly ci: string[];
}

export interface WorldHandle {
  readonly root: string;
  readonly origin: string;
  readonly git: (cwd: string, ...args: string[]) => Promise<string>;
  readonly run: (world: StreamsWorld, run?: StreamsRun) => Promise<StreamsRun>;
  readonly dispose: () => Promise<void>;
  /** Файл в origin/stage-07 или undefined. */
  readonly originFile: (path: string) => Promise<string | undefined>;
}

const statusText = (queue: string): string => `# Статус

| Текущий этап | 07 — тестовый этап |
| Ветка | \`stage-07\` |

Очередь: ${queue}
`;

const setMark = (stage: string, task: string, mark: TaskMark): string =>
  stage.replace(new RegExp(`^- \\[[^\\]]\\] \\*\\*${task}\\.`, 'm'), `- [${mark}] **${task}.`);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Репозиторий с веткой stage-07, файлом этапа и STATUS; главный каталог — `<tmp>/Hexfront`. */
export async function createWorld(world: StreamsWorld): Promise<WorldHandle> {
  const base = await mkdtemp(join(tmpdir(), 'hexfront-streams-'));
  const origin = join(base, 'origin.git');
  const root = join(base, 'Hexfront');
  const git = async (cwd: string, ...args: string[]): Promise<string> => {
    const result = await realRun('git', args, { cwd });
    if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  await git(base, 'init', '--bare', '-b', 'main', origin);
  await git(base, 'clone', origin, root);
  for (const args of [
    ['config', 'user.email', 'loop@test'],
    ['config', 'user.name', 'loop'],
    ['config', 'core.hooksPath', 'no-hooks'],
  ])
    await git(root, ...args);
  const files: Record<string, string> = {
    '.gitignore': '.ai-logs/\nnode_modules/\n',
    'docs/STATUS.md': statusText(world.queue),
    [STAGE_FILE]: world.stage,
    'docs/reports/stage-07.md': '# Отчёт\n',
    'src/shared.txt': 'начало\n\n\n\n\n\n\n\n\nконец\n',
    'tools/agent-loop/roles.json': JSON.stringify({
      next: { reasoningEffort: 'medium' },
      review: { reasoningEffort: 'medium' },
    }),
    'tools/agent-loop/permissions.json': JSON.stringify({
      reviewer: ['docs/stages/**', 'docs/STATUS.md', 'docs/reports/**', '.ai-logs/**'],
      spec: ['**/*.test.ts'],
    }),
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  await git(root, 'add', '-A');
  await git(root, 'commit', '-m', 'init');
  await git(root, 'push', 'origin', 'main');
  await git(root, 'checkout', '-b', 'stage-07');
  await git(root, 'push', '-u', 'origin', 'stage-07');
  return {
    root,
    origin,
    git,
    run: (w, previous) => runWorld(root, git, w, previous),
    dispose: () => rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
    originFile: async (path) => {
      const shown = await realRun('git', ['show', `origin/stage-07:${path}`], { cwd: root });
      return shown.code === 0 ? shown.stdout : undefined;
    },
  };
}

type Git = (cwd: string, ...args: string[]) => Promise<string>;

async function nextTask(cwd: string): Promise<string> {
  const status = await readFile(join(cwd, 'docs/STATUS.md'), 'utf8');
  const stage = await readFile(join(cwd, STAGE_FILE), 'utf8');
  const queue = status.match(/Очередь:\s*([^\n]+)/)?.[1]?.split(' → ') ?? [];
  return (
    queue.find((task) =>
      new RegExp(`^- \\[[ ~]\\] \\*\\*${task.split('/')[1]}\\.`, 'm').test(stage),
    ) ?? ''
  );
}

/** Поддельный codex: работает настоящим git в каталоге сессии, как работал бы скилл. */
function fakeCodex(git: Git, world: StreamsWorld) {
  const reviews = new Map(Object.entries(world.tasks).map(([t, b]) => [t, [...(b.reviews ?? [])]]));
  const crashes = new Map(Object.entries(world.tasks).map(([t, b]) => [t, b.crashes ?? 0]));
  const asks = new Map(Object.entries(world.tasks).map(([t, b]) => [t, b.asks ?? 0]));
  const commit = async (cwd: string, message: string, task: string): Promise<void> => {
    await git(cwd, 'add', '-A');
    await git(cwd, 'commit', '-m', `${message}\n\nЭтап: ${task}`);
    await git(cwd, 'push', '-u', 'origin', 'HEAD');
  };
  const markFile = async (cwd: string, short: string, mark: TaskMark): Promise<void> => {
    const path = join(cwd, STAGE_FILE);
    await writeFile(path, setMark(await readFile(path, 'utf8'), short, mark));
  };
  return async (prompt: string, cwd: string): Promise<{ code: number; answer: string }> => {
    const first = prompt.split('\n', 1)[0] ?? '';
    // `$next` цикла по одной задаче: первая открытая задача очереди, как её нашёл бы скилл.
    const task = first.startsWith('$next')
      ? await nextTask(cwd)
      : (first.match(/(\d{2}\/T\w+)/)?.[1] ?? '');
    const short = task.split('/')[1] ?? '';
    const behaviour = world.tasks[short] ?? {};
    if (first.startsWith('$decide')) {
      const path = join(cwd, STAGE_FILE);
      await writeFile(path, world.decide?.stage(await readFile(path, 'utf8')) ?? '');
      await git(cwd, 'add', '-A');
      await git(cwd, 'commit', '-m', 'docs(docs): решение\n\nЭтап: 07');
      await git(cwd, 'push', 'origin', 'HEAD');
      return { code: 0, answer: 'Изменён файл этапа' };
    }
    if (first.startsWith('$review')) {
      const verdict = reviews.get(short)?.shift() ?? 'OK';
      const stage = await readFile(join(cwd, STAGE_FILE), 'utf8');
      const again = /Повторное ревью/.test(prompt) && stage.includes(`- [x] **${short}.`);
      if (verdict === 'OK' && again) return { code: 0, answer: 'OK' };
      await markFile(cwd, short, verdict === 'OK' ? 'x' : ' ');
      await commit(cwd, `docs(docs): ревью ${short}`, task);
      return { code: 0, answer: verdict === 'OK' ? 'OK' : 'ВОЗВРАТ\n- пункт — файл:1 — не так' };
    }
    if (first.includes('слияние')) {
      await realRun('git', ['merge', '--no-edit', 'origin/stage-07'], { cwd });
      const conflicted = (await git(cwd, 'diff', '--name-only', '--diff-filter=U'))
        .split('\n')
        .filter(Boolean);
      for (const path of conflicted) {
        const text = await readFile(join(cwd, path), 'utf8');
        await writeFile(join(cwd, path), text.replace(/^(<<<<<<<|=======|>>>>>>>).*\n/gm, ''));
      }
      await commit(cwd, `chore(infra): слияние ${short}`, task);
      return { code: 0, answer: 'конфликт разрешён' };
    }
    if (first.includes('CI красный')) {
      await writeFile(join(cwd, `src/${short}-fix.txt`), 'исправлено\n');
      await commit(cwd, `fix(client): CI ${short}`, task);
      return { code: 0, answer: 'CI исправлен' };
    }
    await sleep(behaviour.workMs ?? 30);
    const questions = asks.get(short) ?? 0;
    if (questions > 0) {
      asks.set(short, questions - 1);
      return { code: 0, answer: `Вопрос по ${task} записан. Ждёт владельца: ответ через $decide` };
    }
    for (const [path, text] of Object.entries(
      behaviour.writes ?? { [`src/${short}.txt`]: `${short}\n` },
    )) {
      await mkdir(dirname(join(cwd, path)), { recursive: true });
      const current = await readFile(join(cwd, path), 'utf8').catch(() => '');
      // `^текст` — строка после «начало», `+текст` — перед «конец»: правки разных мест одного файла.
      const next = text.startsWith('^')
        ? current.replace('начало', `начало\n${text.slice(1)}`)
        : text.startsWith('+')
          ? current.replace('конец', `${text.slice(1)}\nконец`)
          : text;
      await writeFile(join(cwd, path), next);
    }
    const left = crashes.get(short) ?? 0;
    if (left > 0 && !first.includes('продолжить')) {
      crashes.set(short, left - 1);
      return { code: 1, answer: 'обрыв сессии' };
    }
    await markFile(cwd, short, '~');
    await commit(cwd, `feat(client): задача ${short}`, task);
    return { code: 0, answer: `Задача ${task} готова. Запусти \`$review ${task}\` в новой сессии` };
  };
}

function fakeGithub(world: StreamsWorld): GithubClient | undefined {
  const { decide } = world;
  const planned = [
    ...(decide === undefined ? [] : [{ atList: decide.atList, body: '$decide\nизменить задачу' }]),
    ...(world.commands ?? []),
  ];
  if (planned.length === 0) return undefined;
  let lists = 0;
  const closed = new Set<number>();
  const issues: AgentIssue[] = planned.map((plan, index) => ({
    number: index + 1,
    title: plan.body.split('\n', 1)[0] ?? '',
    body: plan.body,
    author: 'owner',
    labels: ['agent'],
    updatedAt: '2026-10-14T00:00:00Z',
  }));
  const visible = (issue: AgentIssue): boolean =>
    lists >= (planned[issue.number - 1]?.atList ?? 0) && !closed.has(issue.number);
  return {
    repo: 'owner/game',
    owner: 'owner',
    listIssues: () => {
      lists += 1;
      return Promise.resolve(issues.filter(visible));
    },
    openIssue: (number) => Promise.resolve(issues.find((i) => i.number === number && visible(i))),
    comment: () => Promise.resolve(),
    close: (number) => {
      closed.add(number);
      return Promise.resolve();
    },
    addLabel: () => Promise.resolve(),
    openPullRequest: () => Promise.resolve('https://example/pr'),
    changed: () => Promise.resolve(false),
  };
}

async function runWorld(
  root: string,
  git: Git,
  world: StreamsWorld,
  previous?: StreamsRun,
): Promise<StreamsRun> {
  const out: StreamsRun = previous ?? { code: 0, prompts: [], events: [], lines: [], ci: [] };
  const codex = fakeCodex(git, world);
  const ci = [...(world.ci ?? [])];
  const github = fakeGithub(world);
  const runCommand: RunCommand = async (command, args, options = {}): Promise<CommandResult> => {
    const cwd = options.cwd ?? root;
    if (command === 'git') return realRun(command, args, options);
    if (command === 'pnpm' && args[0] === 'install') return { code: 0, stdout: '', stderr: '' };
    if (command === 'pnpm' && args.includes('--workflow=slow.yml'))
      return { code: 0, stdout: 'success https://slow/1', stderr: '' };
    if (command === 'pnpm') {
      const sha = await git(cwd, 'rev-parse', 'HEAD');
      out.ci.push(sha);
      // Как настоящий CI: незапушенный коммит прогона не имеет.
      if ((await git(cwd, 'branch', '-r', '--contains', sha)) === '')
        return { code: 1, stdout: `error run=not-found sha=${sha}`, stderr: '' };
      const verdict = ci.shift() ?? 'success';
      return verdict === 'success'
        ? { code: 0, stdout: 'success https://ci/1', stderr: '' }
        : { code: 1, stdout: 'failure job=check https://ci/2', stderr: '' };
    }
    const prompt = options.input ?? '';
    const title = prompt.split('\n', 1)[0] ?? '';
    out.prompts.push({ prompt, cwd });
    out.events.push(`start:${title}`);
    const result = await codex(prompt, cwd);
    out.events.push(`end:${title}`);
    const file = args[args.indexOf('--output-last-message') + 1]?.replace(/^"|"$/g, '');
    if (file !== undefined) await writeFile(file, result.answer);
    return { code: result.code, stdout: result.answer, stderr: '' };
  };
  out.code = await runAgentLoop({
    root,
    maxRounds: 3,
    maxMinutes: 10,
    pollSeconds: 30,
    pollMinutes: 10,
    once: true,
    dryRun: false,
    streams: world.streams ?? 2,
    runCommand,
    now: Date.now,
    sleep: () => sleep(10).then(() => 'timer' as const),
    writeLine: (line) => out.lines.push(line),
    ...(github === undefined ? {} : { github }),
  });
  return out;
}
