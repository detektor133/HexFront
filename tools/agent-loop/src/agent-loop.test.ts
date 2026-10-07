import { readFile, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  runAgentLoop,
  selectIssueOrQueue,
  type AgentConfig,
  type CommandResult,
  type GithubClient,
  type GithubIssue,
} from './agent-loop.ts';

const root = process.cwd();
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
  readonly maxTasks?: number;
}

async function runScenario(scenario: Scenario): Promise<{
  readonly code: number;
  readonly roles: string[];
  readonly comments: string[];
  readonly resets: number;
}> {
  const outputs = [...scenario.outputs];
  const ci = [...scenario.ci];
  const roles: string[] = [];
  const comments: string[] = [];
  let resets = 0;
  let listCalls = 0;
  let dirtyRole = '';
  const runCommand = async (command: string, args: readonly string[]): Promise<CommandResult> => {
    if (command === 'git' && args[0] === 'branch')
      return { code: 0, stdout: 'stage-05', stderr: '' };
    if (command === 'git' && args[0] === 'rev-parse')
      return { code: 0, stdout: 'base', stderr: '' };
    if (command === 'git' && args[0] === 'status') return { code: 0, stdout: '', stderr: '' };
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
      const prompt = String(args.at(-1));
      const role = prompt.match(/Роль: (\w+)/)?.[1] ?? '';
      roles.push(role);
      dirtyRole = scenario.changedRole === role ? role : '';
      if (scenario.changeQuestions && role === 'planner')
        await writeFile(
          `${root}/docs/QUESTIONS.md`,
          `${await readFile(`${root}/docs/QUESTIONS.md`, 'utf8')}\nизменение теста`,
          'utf8',
        );
      return { code: 0, stdout: outputs.shift() ?? 'OK', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const github: GithubClient = {
    ensureAgentLabel: async () => undefined,
    listAgentIssues: async () => {
      listCalls += 1;
      return scenario.issues ?? [issue(1)];
    },
    comment: async (_number, body) => {
      comments.push(body);
    },
    close: async () => undefined,
  };
  const config: AgentConfig = {
    root,
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
  const questionsPath = `${root}/docs/QUESTIONS.md`;
  const questions = await readFile(questionsPath, 'utf8');
  try {
    return { code: await runAgentLoop(config), roles, comments, resets };
  } finally {
    if (scenario.changeQuestions) await writeFile(questionsPath, questions, 'utf8');
    void listCalls;
  }
}

describe('выбор задач', () => {
  it('выбирает Issue по возрастанию и затем очередь', () => {
    expect(selectIssueOrQueue([issue(4), issue(2)], 'Очередь: 05/T15c → 05/T15d')?.number).toBe(2);
    expect(selectIssueOrQueue([], 'Очередь: 05/T15c → 05/T15d')?.task).toBe('05/T15c');
  });
});

describe('runAgentLoop', () => {
  it('проходит успешную задачу в точной последовательности', async () => {
    const result = await runScenario({ outputs: ['OK', 'OK', 'OK', 'OK'], ci: [0] });
    expect(result.code).toBe(0);
    expect(result.roles).toEqual(['planner', 'tester', 'coder', 'reviewer']);
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
    expect(result.comments).toHaveLength(1);
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
    expect(result.comments).toHaveLength(1);
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
      expect(result.comments).toHaveLength(1);
    },
  );

  it('останавливает задачу владельца с комментарием без вызова роли', async () => {
    const result = await runScenario({
      outputs: [],
      ci: [],
      issues: [issue(1, 'плейтест владельца')],
    });
    expect(result.code).toBe(1);
    expect(result.roles).toEqual([]);
    expect(result.comments).toHaveLength(1);
  });

  it('останавливается при изменении QUESTIONS после planner', async () => {
    const result = await runScenario({ outputs: ['OK'], ci: [], changeQuestions: true });
    expect(result.code).toBe(1);
    expect(result.comments).toHaveLength(1);
  });

  it('берёт две задачи при maxTasks=2', async () => {
    const result = await runScenario({
      outputs: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK'],
      ci: [0, 0],
      issues: [issue(1), issue(2)],
      maxTasks: 2,
    });
    expect(result.code).toBe(0);
    expect(result.roles).toHaveLength(8);
  });
});
