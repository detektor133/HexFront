import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultRunCommand,
  prepareProcessArguments,
  runAgentLoop,
  type CommandResult,
} from './agent-loop.ts';
import { isOwnerTask, selectTask, taskMark, type TaskMark } from './stage-file.ts';

const fixtureStatus = `# Статус

| Текущий этап | 06 — тестовый этап |
| Ветка | \`stage-06\` |

Очередь: 06/T1j5-Б1 → 06/T1i → 06/T1e
`;
const fixtureStage = `# Этап 06

- [ ] **T1. Родитель**, не задача владельца.
- [ ] **T1i. Обучение весов**, задача владельца. Владелец запускает \`pnpm evolve\`.
- [ ] **T1e. Проверка родителя T1**, сквозная проверка, не задача владельца.
  *Приёмка:* отмечается \`[x]\` только после пройденного \`$accept 06/T1\`.
- [ ] **T1j5-Б1. Фитнес по метрикам самой особи** (tools/evolve).
  *Приёмка:* тесты.
`;
const fixtureRoles = JSON.stringify({
  next: { model: 'luna', reasoningEffort: 'medium' },
  review: { reasoningEffort: 'medium' },
});
const fixturePermissions = JSON.stringify({
  reviewer: ['docs/stages/**', 'docs/STATUS.md', 'docs/reports/**', '.ai-logs/**'],
});

/** Что делает одна сессия codex: новая отметка задачи, коммит, push, файлы, ответ. */
interface Session {
  readonly mark?: TaskMark;
  readonly task?: string;
  readonly commit?: boolean;
  readonly push?: boolean;
  readonly files?: readonly string[];
  readonly dirty?: boolean;
  readonly answer: string;
  readonly code?: number;
}

interface Scenario {
  readonly sessions: readonly Session[];
  readonly ci?: readonly string[];
  readonly status?: string;
  readonly stage?: string;
  readonly maxTasks?: number;
  readonly maxRounds?: number;
  readonly dryRun?: boolean;
  readonly branch?: string;
}

interface ScenarioResult {
  readonly code: number;
  readonly prompts: string[];
  readonly roles: (string | undefined)[];
  readonly codexArguments: (readonly string[])[];
  readonly lines: string[];
  readonly resets: number;
  readonly ciCalls: number;
}

const setMark = (stage: string, task: string, mark: TaskMark): string =>
  stage.replace(new RegExp(`^- \\[[^\\]]\\] \\*\\*${task}\\.`, 'm'), `- [${mark}] **${task}.`);

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const root = await mkdtemp(join(tmpdir(), 'hexfront-agent-loop-test-'));
  const stagePath = join(root, 'docs/stages/stage-06-bots-balance.md');
  await mkdir(join(root, 'docs/stages'), { recursive: true });
  await mkdir(join(root, 'tools/agent-loop'), { recursive: true });
  await writeFile(join(root, 'docs/STATUS.md'), scenario.status ?? fixtureStatus, 'utf8');
  await writeFile(stagePath, scenario.stage ?? fixtureStage, 'utf8');
  await writeFile(join(root, 'tools/agent-loop/roles.json'), fixtureRoles, 'utf8');
  await writeFile(join(root, 'tools/agent-loop/permissions.json'), fixturePermissions, 'utf8');
  const sessions = [...scenario.sessions];
  const ci = [...(scenario.ci ?? [])];
  const result: ScenarioResult = {
    code: 0,
    prompts: [],
    roles: [],
    codexArguments: [],
    lines: [],
    resets: 0,
    ciCalls: 0,
  };
  let resets = 0;
  let ciCalls = 0;
  let head = 0;
  let origin = 0;
  let dirty = '';
  let files: readonly string[] = [];
  const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
  const runCommand = async (
    command: string,
    args: readonly string[],
    options?: { readonly input?: string; readonly env?: NodeJS.ProcessEnv },
  ): Promise<CommandResult> => {
    if (command === 'pnpm') {
      ciCalls += 1;
      const line = ci.shift() ?? 'success https://ci/1';
      return { code: line.startsWith('success') ? 0 : 1, stdout: line, stderr: '' };
    }
    if (command === 'codex') {
      result.prompts.push(options?.input ?? '');
      result.roles.push(options?.env?.AGENT_ROLE);
      result.codexArguments.push(args);
      const session = sessions.shift();
      if (!session) throw new Error('лишний вызов codex');
      if (session.mark && session.task)
        await writeFile(
          stagePath,
          setMark(await readFile(stagePath, 'utf8'), session.task, session.mark),
          'utf8',
        );
      if (session.commit !== false && session.mark) head += 1;
      if (session.push !== false) origin = head;
      files = session.files ?? ['docs/stages/stage-06-bots-balance.md'];
      dirty = session.dirty ? ' M packages/sim/src/step.ts' : '';
      return { code: session.code ?? 0, stdout: session.answer, stderr: '' };
    }
    const [sub, arg] = args;
    if (sub === 'branch') return ok(scenario.branch ?? 'stage-06');
    if (sub === 'status') return ok(dirty);
    if (sub === 'fetch') return ok();
    if (sub === 'rev-parse') return ok(String(arg?.startsWith('origin/') ? origin : head));
    if (sub === 'diff') return ok(files.join('\n'));
    if (sub === 'reset') {
      resets += 1;
      dirty = '';
      return ok();
    }
    throw new Error(`неожиданная команда ${command} ${args.join(' ')}`);
  };
  try {
    const code = await runAgentLoop({
      root,
      maxTasks: scenario.maxTasks ?? 1,
      maxRounds: scenario.maxRounds ?? 3,
      maxMinutes: 10,
      dryRun: scenario.dryRun ?? false,
      runCommand,
      now: (() => {
        let time = 0;
        return () => (time += 1);
      })(),
      writeLine: (line) => result.lines.push(line),
    });
    return { ...result, code, resets, ciCalls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const NEXT_DONE: Session = {
  task: 'T1j5-Б1',
  mark: '~',
  answer: 'Готово.\nЗапусти `$review 06/T1j5-Б1` в новой сессии',
};
const REVIEW_OK: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'OK\nвсё подтверждено' };
const REVIEW_BACK: Session = {
  task: 'T1j5-Б1',
  mark: ' ',
  answer: 'ВОЗВРАТ\n- п.1 — evaluate.ts:95 — штраф по чужим метрикам',
};

describe('разбор файла этапа', () => {
  it('выбирает первую незакрытую задачу очереди, включая [~]', () => {
    expect(selectTask(fixtureStatus, fixtureStage)).toBe('06/T1j5-Б1');
    const reviewed = setMark(fixtureStage, 'T1j5-Б1', 'x');
    expect(selectTask(fixtureStatus, reviewed)).toBe('06/T1i');
    expect(selectTask(fixtureStatus, setMark(fixtureStage, 'T1j5-Б1', '~'))).toBe('06/T1j5-Б1');
  });

  it('не путает T1 с T1i и T1e при чтении отметки', () => {
    const stage = setMark(fixtureStage, 'T1i', 'x');
    expect(taskMark(stage, '06/T1')).toBe(' ');
    expect(taskMark(stage, '06/T1i')).toBe('x');
    expect(taskMark(stage, '06/T1e')).toBe(' ');
    expect(taskMark(stage, '06/T9')).toBeUndefined();
  });

  it('считает задачей владельца только первую строку без «не задача владельца»', () => {
    expect(isOwnerTask('- [ ] **T1i. Обучение весов**, задача владельца.')).toBe(true);
    expect(isOwnerTask('- [ ] **T8. Плейтест**')).toBe(true);
    expect(
      isOwnerTask('- [ ] **T1e. Проверка**, не задача владельца.\n  после $accept 06/T1'),
    ).toBe(false);
  });
});

describe('цикл $next → CI → $review', () => {
  it('проходит задачу за один круг: $next без роли, CI, $review с ролью reviewer', async () => {
    const run = await runScenario({ sessions: [NEXT_DONE, REVIEW_OK] });
    expect(run.code).toBe(0);
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
    expect(run.roles).toEqual(['', 'reviewer']);
    expect(run.ciCalls).toBe(1);
    expect(run.lines).toContain('готово: 06/T1j5-Б1 (1 из 1)');
    expect(run.lines.filter((line) => /^(→|←|… жду CI|CI зелёный)/.test(line))).toHaveLength(6);
  });

  it('передаёт модель только если она задана, и усилие medium', async () => {
    const run = await runScenario({ sessions: [NEXT_DONE, REVIEW_OK] });
    // На Windows аргументы приходят в кавычках для cmd, поэтому сравнение — без них.
    const plain = run.codexArguments.map((args) => args.map((arg) => arg.replace(/^"|"$/g, '')));
    expect(plain[0]).toEqual(
      expect.arrayContaining(['--model', 'luna', 'model_reasoning_effort=medium']),
    );
    expect(plain[1]).not.toContain('--model');
  });

  it('после ВОЗВРАТ снова запускает $next и затем $review', async () => {
    const run = await runScenario({ sessions: [NEXT_DONE, REVIEW_BACK, NEXT_DONE, REVIEW_OK] });
    expect(run.code).toBe(0);
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1', '$next', '$review 06/T1j5-Б1']);
    expect(run.lines).toContain('ВОЗВРАТ 06/T1j5-Б1, круг 1 из 3');
  });

  it('останавливается после maxRounds ВОЗВРАТ подряд', async () => {
    const run = await runScenario({
      maxRounds: 2,
      sessions: [NEXT_DONE, REVIEW_BACK, NEXT_DONE, REVIEW_BACK],
    });
    expect(run.code).toBe(1);
    expect(run.prompts).toHaveLength(4);
    expect(run.lines).toContain(
      'стоп: круги — 2 ВОЗВРАТ подряд по 06/T1j5-Б1 — нужно решение владельца',
    );
  });

  it('начинает с $review, если задача уже [~]', async () => {
    const run = await runScenario({
      stage: setMark(fixtureStage, 'T1j5-Б1', '~'),
      sessions: [REVIEW_OK],
    });
    expect(run.code).toBe(0);
    expect(run.prompts).toEqual(['$review 06/T1j5-Б1']);
    expect(run.ciCalls).toBe(0);
  });

  it('останавливается на задаче владельца без вызова codex', async () => {
    const run = await runScenario({ stage: setMark(fixtureStage, 'T1j5-Б1', 'x'), sessions: [] });
    expect(run.code).toBe(1);
    expect(run.prompts).toEqual([]);
    expect(run.lines).toContain(
      'стоп: выбор задачи — очередь дошла до 06/T1i — это задача владельца',
    );
  });

  it('берёт следующую задачу после выполненной и останавливается на задаче владельца', async () => {
    const run = await runScenario({ maxTasks: 3, sessions: [NEXT_DONE, REVIEW_OK] });
    expect(run.code).toBe(0);
    expect(run.prompts).toHaveLength(2);
    expect(run.lines).toContain(
      'стоп: выбор задачи — очередь дошла до 06/T1i — это задача владельца',
    );
  });

  it('не запускает T1e как задачу владельца из-за «$accept» в приёмке', async () => {
    const stage = setMark(setMark(fixtureStage, 'T1j5-Б1', 'x'), 'T1i', 'x');
    const run = await runScenario({
      stage,
      sessions: [{ answer: 'T1e требует $accept владельца, задача оставлена [ ]' }],
    });
    expect(run.prompts).toEqual(['$next']);
    expect(run.lines).toContain(
      'стоп: $next — задача не отмечена [~] — $next остановился сам (см. его ответ)',
    );
  });

  it('останавливается, если $next не отметил задачу [~] (вопрос, $split, второй красный verify)', async () => {
    const run = await runScenario({ sessions: [{ answer: 'запусти `$split 06/T1j5-Б1`' }] });
    expect(run.code).toBe(1);
    expect(run.prompts).toEqual(['$next']);
    expect(run.lines.some((line) => line.includes('запусти `$split 06/T1j5-Б1`'))).toBe(true);
  });

  it('останавливается при красном CI после $next, не запуская $review', async () => {
    const run = await runScenario({
      sessions: [NEXT_DONE],
      ci: ['failure job=check https://ci/2'],
    });
    expect(run.code).toBe(1);
    expect(run.prompts).toEqual(['$next']);
    expect(run.lines).toContain('стоп: CI после $next — CI красный');
  });

  it('повторяет ожидание CI один раз после таймаута', async () => {
    const run = await runScenario({
      sessions: [NEXT_DONE, REVIEW_OK],
      ci: ['failure timeout https://ci/3', 'success https://ci/3'],
    });
    expect(run.code).toBe(0);
    expect(run.ciCalls).toBe(2);
  });

  it('останавливается, если $next не запушил коммит', async () => {
    const run = await runScenario({ sessions: [{ ...NEXT_DONE, push: false }] });
    expect(run.code).toBe(1);
    expect(run.lines).toContain(
      'стоп: $next — HEAD не совпадает с origin/stage-06: сессия не запушила коммит',
    );
  });

  it('останавливается без отката, если запушенное ревью изменило код', async () => {
    const run = await runScenario({
      sessions: [NEXT_DONE, { ...REVIEW_OK, files: ['packages/sim/src/step.ts'] }],
    });
    expect(run.code).toBe(1);
    expect(run.resets).toBe(0);
    expect(run.lines).toContain(
      'стоп: $review — ревью изменило файлы вне permissions.json — проверь коммит',
    );
  });

  it('останавливается, если ответ ревью не совпадает с отметкой', async () => {
    const run = await runScenario({ sessions: [NEXT_DONE, { ...REVIEW_OK, mark: '~' }] });
    expect(run.code).toBe(1);
    expect(run.lines).toContain('стоп: $review — ответ «OK» не совпадает с отметкой [~]');
  });

  it('останавливается при ненулевом коде codex (например, кончился лимит)', async () => {
    const run = await runScenario({ sessions: [{ answer: 'usage limit reached', code: 1 }] });
    expect(run.code).toBe(1);
    expect(run.lines).toContain('стоп: $next — codex завершился с кодом 1');
  });

  it('проверяет ветку и чистоту дерева до первой сессии', async () => {
    const run = await runScenario({ branch: 'main', sessions: [] });
    expect(run.code).toBe(1);
    expect(run.lines).toContain('стоп: проверка ветки — ожидалась stage-06, найдена main');
  });

  it('в --dry-run только печатает план', async () => {
    const run = await runScenario({ dryRun: true, sessions: [] });
    expect(run.code).toBe(0);
    expect(run.lines).toEqual(['$next → CI → $review: 06/T1j5-Б1']);
  });
});

describe('запуск процесса', () => {
  it('передаёт спецсимволы stdin подменённому процессу без изменений', async () => {
    const input = 'строка "кавычки" $next & | > <\nвторая строка';
    // Команда без пути: на Windows cmd разрезал бы `C:\Program Files\…\node.exe` по пробелу.
    const result = await defaultRunCommand(
      'node',
      prepareProcessArguments(['-e', 'process.stdin.pipe(process.stdout)']),
      { input },
    );
    expect(result.stdout).toBe(input);
  });
});
