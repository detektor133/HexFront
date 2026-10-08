import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  runAgentLoop,
  defaultRunCommand,
  prepareProcessArguments,
  selectIssueOrQueue,
  type AgentConfig,
  type CommandResult,
  type GithubClient,
  type GithubIssue,
} from './agent-loop.ts';

const fixtureStatus = `# Статус

| Текущий этап | 05 — тестовый этап |

Очередь: 05/T15c → 05/T15d
`;
const fixtureStage = `# Этап 05

- [ ] **T15c. Тестовая задача**
  *Приёмка:* тесты подтверждают, что ход бота не строит playerView.
- [ ] **T15d. Задача владельца**
  *Приёмка:* $accept запускает проверку.
- [ ] **T1a5. Плейтест** — задача владельца
`;
const fixtureRoles = JSON.stringify({
  planner: { model: 'planner', reasoningEffort: 'high', skill: 'plan' },
  tester: { model: 'tester', reasoningEffort: 'medium', skill: 'tests' },
  coder: { model: 'coder', reasoningEffort: 'medium', skill: 'code' },
  reviewer: { model: 'reviewer', reasoningEffort: 'high', skill: 'review' },
});
const fixturePermissions = JSON.stringify({
  planner: ['docs/**', '.ai-logs/**'],
  tester: ['**/test/**', '**/*.test.ts', '.ai-logs/**'],
  coder: ['packages/*/src/**', 'tools/*/src/**', '.ai-logs/**'],
  reviewer: ['docs/**', 'docs/reports/**', '.ai-logs/**'],
});
const issue = (number: number, title = `задача ${number}`): GithubIssue => ({
  number,
  title,
  body: 'T15c',
  labels: [{ name: 'agent' }],
  state: 'open',
});

interface Scenario {
  readonly outputs: string[];
  readonly ci: number[];
  readonly issues?: readonly GithubIssue[];
  readonly changedRole?: string;
  readonly changeQuestions?: boolean;
  readonly coderCommit?: boolean;
  readonly dirtyAfterCoder?: boolean;
  readonly queue?: string;
  readonly plannedIssue?: number;
  readonly maxTasks?: number;
  readonly codexCode?: number;
  readonly codexStderr?: string;
}

async function runScenario(scenario: Scenario): Promise<{
  readonly code: number;
  readonly roles: string[];
  readonly comments: string[];
  readonly resets: number;
  readonly tasks: string[];
  readonly codexInputs: string[];
  readonly codexArguments: readonly (readonly string[])[];
}> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'hexfront-agent-loop-test-'));
  const outputs = [...scenario.outputs];
  const ci = [...scenario.ci];
  const roles: string[] = [];
  const tasks: string[] = [];
  const codexInputs: string[] = [];
  const codexArguments: string[][] = [];
  const comments: string[] = [];
  let resets = 0;
  let listCalls = 0;
  let dirtyRole = '';
  let head = 'base';
  const runCommand = async (
    command: string,
    args: readonly string[],
    options?: { readonly input?: string },
  ): Promise<CommandResult> => {
    if (command === 'git' && args[0] === 'branch')
      return { code: 0, stdout: 'stage-05', stderr: '' };
    if (command === 'git' && args[0] === 'rev-parse') return { code: 0, stdout: head, stderr: '' };
    if (command === 'git' && args[0] === 'status')
      return {
        code: 0,
        stdout:
          scenario.dirtyAfterCoder && roles.at(-1) === 'coder'
            ? ' M tools/agent-loop/src/agent-loop.ts'
            : '',
        stderr: '',
      };
    if (command === 'git' && args[0] === 'diff')
      return {
        code: 0,
        stdout:
          dirtyRole === 'coder'
            ? 'docs/not-allowed.md'
            : dirtyRole
              ? 'packages/sim/src/not-allowed.ts'
              : '',
        stderr: '',
      };
    if (command === 'git' && args[0] === 'reset') {
      resets += 1;
      return { code: 0, stdout: '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'push') return { code: 0, stdout: '', stderr: '' };
    if (command === 'pnpm') return { code: ci.shift() ?? 0, stdout: 'ci', stderr: '' };
    if (command === 'codex') {
      const prompt = options?.input ?? '';
      codexInputs.push(prompt);
      codexArguments.push([...args]);
      const role = prompt.match(/Роль: (\w+)/)?.[1] ?? '';
      roles.push(role);
      tasks.push(prompt.match(/Задача: ([^\n]+)/)?.[1] ?? '');
      dirtyRole = scenario.changedRole === role ? role : '';
      if (role === 'coder' && scenario.coderCommit !== false) head = `commit-${roles.length}`;
      if (scenario.changeQuestions && role === 'planner')
        await writeFile(
          `${fixtureRoot}/docs/QUESTIONS.md`,
          `${await readFile(`${fixtureRoot}/docs/QUESTIONS.md`, 'utf8')}\nизменение теста`,
          'utf8',
        );
      return {
        code: scenario.codexCode ?? 0,
        stdout: outputs.shift() ?? 'OK',
        stderr: scenario.codexStderr ?? '',
      };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const github: GithubClient = {
    ensureAgentLabel: async () => undefined,
    listAgentIssues: async () => {
      listCalls += 1;
      return scenario.issues ?? [];
    },
    comment: async (_number, body) => {
      comments.push(body);
    },
    close: async () => undefined,
  };
  const config: AgentConfig = {
    root: fixtureRoot,
    maxTasks: scenario.maxTasks ?? 1,
    maxMinutes: 10,
    dryRun: false,
    runCommand,
    github,
    now: (() => {
      let time = 0;
      return () => (time += 1);
    })(),
    writeLine: () => undefined,
  };
  const questionsPath = `${fixtureRoot}/docs/QUESTIONS.md`;
  const statusPath = `${fixtureRoot}/docs/STATUS.md`;
  const stagePath = `${fixtureRoot}/docs/stages/stage-05-bots-maps-balance.md`;
  await mkdir(`${fixtureRoot}/docs/stages`, { recursive: true });
  await mkdir(`${fixtureRoot}/tools/agent-loop`, { recursive: true });
  const questions = '# Вопросы\n';
  await writeFile(questionsPath, questions, 'utf8');
  await writeFile(statusPath, fixtureStatus, 'utf8');
  await writeFile(stagePath, fixtureStage, 'utf8');
  await writeFile(`${fixtureRoot}/tools/agent-loop/roles.json`, fixtureRoles, 'utf8');
  await writeFile(`${fixtureRoot}/tools/agent-loop/permissions.json`, fixturePermissions, 'utf8');
  const status = fixtureStatus;
  const stage = fixtureStage;
  try {
    if (scenario.queue)
      await writeFile(
        statusPath,
        status.replace(/^Очередь:.*$/m, `Очередь: ${scenario.queue}`),
        'utf8',
      );
    if (scenario.plannedIssue)
      await writeFile(
        stagePath,
        stage.replace(
          '  *Приёмка:* тесты подтверждают, что ход бота',
          `  Issue #${scenario.plannedIssue}\n  План: существующий план\n  *Приёмка:* тесты подтверждают, что ход бота`,
        ),
        'utf8',
      );
    return {
      code: await runAgentLoop(config),
      roles,
      comments,
      resets,
      tasks,
      codexInputs,
      codexArguments,
    };
  } finally {
    if (scenario.changeQuestions) await writeFile(questionsPath, questions, 'utf8');
    if (scenario.queue) await writeFile(statusPath, status, 'utf8');
    if (scenario.plannedIssue) await writeFile(stagePath, stage, 'utf8');
    await rm(fixtureRoot, { recursive: true, force: true });
    void listCalls;
  }
}

describe('выбор задач', () => {
  it('выбирает Issue по возрастанию и затем очередь', () => {
    expect(selectIssueOrQueue([issue(4), issue(2)], 'Очередь: 05/T15c → 05/T15d')?.number).toBe(2);
    expect(selectIssueOrQueue([], 'Очередь: 05/T15c → 05/T15d')?.task).toBe('05/T15c');
  });

  it('пропускает выполненные и отменённые задачи очереди', () => {
    const stage = '- [x] **T10. Готово**\n- [—] **T9a. Отменено**\n- [ ] **T15c. Открыто**';
    expect(
      selectIssueOrQueue([], 'Очередь: 05/T10 → 05/T9a → 05/T15c', new Set(), new Set(), stage)
        ?.task,
    ).toBe('05/T15c');
  });
});

describe('runAgentLoop', () => {
  it('передаёт спецсимволы stdin подмененному процессу без изменений', async () => {
    const input = 'строка 1 с пробелами и "кавычками"\n& | < > кириллица';
    const script = 'process.stdin.pipe(process.stdout)';
    const result = await defaultRunCommand('node', prepareProcessArguments(['-e', script]), {
      input,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(input);
  });

  it('проходит успешную задачу в точной последовательности', async () => {
    const result = await runScenario({ outputs: ['OK', 'OK', 'OK', 'OK'], ci: [0], issues: [] });
    expect(result.code).toBe(0);
    expect(result.roles).toEqual(['planner', 'tester', 'coder', 'reviewer']);
  });

  it('передаёт многострочный промпт через stdin без изменений', async () => {
    const task = 'строка 1\nстрока 2 с пробелами, "кавычками", & | < > и кириллицей';
    const result = await runScenario({
      outputs: ['OK', 'OK', 'OK', 'OK'],
      ci: [0],
      issues: [{ ...issue(1), body: task }],
    });
    expect(result.codexInputs[0]).toContain(`Задача: Issue #1: задача 1\n${task}`);
    expect(result.codexArguments[0]?.at(-1)).toBe(process.platform === 'win32' ? '"-"' : '-');
    expect(result.codexArguments[0]).toContain(
      process.platform === 'win32'
        ? '"model_reasoning_effort=high"'
        : 'model_reasoning_effort=high',
    );
  });

  it('добавляет stderr codex в комментарий при ненулевом коде', async () => {
    const result = await runScenario({
      outputs: [],
      ci: [],
      issues: [issue(1)],
      codexCode: 7,
      codexStderr: 'ошибка 1\nошибка 2',
    });
    expect(result.code).toBe(1);
    expect(result.comments[0]).toContain('Последние строки stderr:\nошибка 1\nошибка 2');
  });

  it('повторяет tester и coder после ответа ТЕСТ:', async () => {
    const result = await runScenario({
      outputs: ['OK', 'OK', 'ТЕСТ: неверный тест', 'OK', 'OK', 'OK'],
      ci: [0],
    });
    expect(result.roles).toEqual(['planner', 'tester', 'coder', 'tester', 'coder', 'reviewer']);
  });

  it('ремонтирует coder один раз после красного CI', async () => {
    const result = await runScenario({ outputs: ['OK', 'OK', 'OK', 'OK', 'OK'], ci: [1, 0] });
    expect(result.roles).toEqual(['planner', 'tester', 'coder', 'coder', 'reviewer']);
  });

  it('останавливается после второго красного CI', async () => {
    const result = await runScenario({ outputs: ['OK', 'OK', 'OK', 'OK'], ci: [1, 1] });
    expect(result.code).toBe(1);
    expect(result.roles).toEqual(['planner', 'tester', 'coder', 'coder']);
    expect(result.comments).toHaveLength(0);
  });

  it('ремонтирует coder после ВОЗВРАТ и вызывает reviewer повторно', async () => {
    const result = await runScenario({
      outputs: ['OK', 'OK', 'OK', 'ВОЗВРАТ причина', 'OK', 'OK'],
      ci: [0, 0],
    });
    expect(result.roles).toEqual(['planner', 'tester', 'coder', 'reviewer', 'coder', 'reviewer']);
  });

  it('останавливается после второго ВОЗВРАТ', async () => {
    const result = await runScenario({
      outputs: ['OK', 'OK', 'OK', 'ВОЗВРАТ причина', 'OK', 'ВОЗВРАТ снова'],
      ci: [0, 0],
    });
    expect(result.code).toBe(1);
    expect(result.comments).toHaveLength(0);
  });

  it.each(['planner', 'tester', 'coder', 'reviewer'])(
    'откатывает нарушение прав роли %s',
    async (role) => {
      const result = await runScenario({
        outputs: ['OK', 'OK', 'OK', 'OK'],
        ci: [0],
        changedRole: role,
      });
      expect(result.code).toBe(1);
      expect(result.resets).toBe(1);
      expect(result.comments).toHaveLength(0);
    },
  );

  it('останавливает задачу владельца с комментарием без вызова роли', async () => {
    const result = await runScenario({
      outputs: [],
      ci: [],
      issues: [{ ...issue(1), body: 'T1a5' }],
    });
    expect(result.code).toBe(1);
    expect(result.roles).toEqual([]);
    expect(result.comments).toHaveLength(1);
  });

  it('не считает строку Приёмка задачей владельца', async () => {
    const result = await runScenario({ outputs: ['OK', 'OK', 'OK', 'OK'], ci: [0], issues: [] });
    expect(result.roles).toEqual(['planner', 'tester', 'coder', 'reviewer']);
  });

  it.each(['05/T1a5', '05/T15d'])('останавливает задачу владельца из очереди %s', async (task) => {
    const result = await runScenario({ outputs: [], ci: [], issues: [], queue: task });
    expect(result.code).toBe(1);
    expect(result.roles).toEqual([]);
  });

  it('требует номер задачи в ответе planner для Issue и передаёт его ролям', async () => {
    const result = await runScenario({
      outputs: ['ЗАДАЧА: 05/T15c', 'OK', 'OK', 'OK'],
      ci: [0],
      issues: [issue(7)],
    });
    expect(result.code).toBe(0);
    expect(result.tasks.slice(1)).toEqual([
      '05/T15c (Issue #7)',
      '05/T15c (Issue #7)',
      '05/T15c (Issue #7)',
    ]);
  });

  it('останавливается для Issue без номера задачи от planner', async () => {
    const result = await runScenario({ outputs: ['OK'], ci: [], issues: [issue(7)] });
    expect(result.code).toBe(1);
    expect(result.roles).toEqual(['planner']);
  });

  it('не вызывает planner для Issue с уже записанным планом и ссылкой', async () => {
    const result = await runScenario({
      outputs: ['OK', 'OK', 'OK'],
      ci: [0],
      issues: [issue(7)],
      plannedIssue: 7,
    });
    expect(result.code).toBe(0);
    expect(result.roles).toEqual(['tester', 'coder', 'reviewer']);
  });

  it('останавливается перед push, если coder не создал коммит', async () => {
    const result = await runScenario({
      outputs: ['OK', 'OK', 'OK'],
      ci: [],
      issues: [],
      coderCommit: false,
    });
    expect(result.code).toBe(1);
    expect(result.roles).toEqual(['planner', 'tester', 'coder']);
  });

  it('останавливается перед push при грязном дереве после coder', async () => {
    const result = await runScenario({
      outputs: ['OK', 'OK', 'OK'],
      ci: [],
      issues: [],
      dirtyAfterCoder: true,
    });
    expect(result.code).toBe(1);
    expect(result.roles).toEqual(['planner', 'tester', 'coder']);
  });

  it('останавливается при изменении QUESTIONS после planner', async () => {
    const result = await runScenario({ outputs: ['OK'], ci: [], changeQuestions: true });
    expect(result.code).toBe(1);
    expect(result.comments).toHaveLength(0);
  });

  it('берёт две задачи при maxTasks=2', async () => {
    const result = await runScenario({
      outputs: ['ЗАДАЧА: 05/T15c', 'OK', 'OK', 'OK', 'ЗАДАЧА: 05/T15c', 'OK', 'OK', 'OK'],
      ci: [0, 0],
      issues: [issue(1), issue(2)],
      maxTasks: 2,
    });
    expect(result.code).toBe(0);
    expect(result.roles).toHaveLength(8);
  });
});
