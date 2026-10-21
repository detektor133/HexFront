import { describe, expect, it } from 'vitest';

import type { Git } from './git.ts';
import { forbiddenPaths, isInfraTask, scopeViolation } from './scope-guard.ts';
import { runWorld, type Session } from './test-world.ts';

const fakeGit = (stdout: string): Git => {
  const attempt = (args: readonly string[]) =>
    Promise.resolve({ code: 0, stdout: args[0] === 'diff' ? stdout : '', stderr: '' });
  return { attempt, run: async (args) => (await attempt(args)).stdout };
};

describe('isInfraTask', () => {
  it('только задачи NN/infra разрешены; обычная задача — нет', () => {
    expect(isInfraTask('07/infra')).toBe(true);
    expect(isInfraTask('07/T22')).toBe(false);
  });
});

describe('forbiddenPaths', () => {
  it('ловит правку кода цикла, настройки и .codex, не трогает обычные файлы', async () => {
    const touched = await forbiddenPaths(
      fakeGit(
        'M\ttools/agent-loop/src/tasks.ts\n' +
          'A\t.codex/hooks/new.mjs\n' +
          'M\ttools/agent-loop/permissions.json\n' +
          'M\tapps/client/test/view-delta-memory.test.ts\n',
      ),
      'c1',
    );
    expect(touched).toEqual([
      'tools/agent-loop/src/tasks.ts',
      '.codex/hooks/new.mjs',
      'tools/agent-loop/permissions.json',
    ]);
  });

  it('без правок запрещённых путей — пусто', async () => {
    expect(await forbiddenPaths(fakeGit('M\tapps/client/src/Hud.tsx\n'), 'c1')).toEqual([]);
  });
});

describe('scopeViolation', () => {
  it('называет задачу, пути и просит Issue владельца или откат', () => {
    const message = scopeViolation('07/T22', ['tools/agent-loop/src/tasks.ts']);
    expect(message).toContain('07/T22');
    expect(message).toContain('tools/agent-loop/src/tasks.ts');
    expect(message).toContain('Issue владельца');
  });
});

const TASK = '06/T1j5-Б1';
const TOUCH_LOOP: Session = {
  task: 'T1j5-Б1',
  mark: '~',
  answer: 'Готово.',
  writes: { 'tools/agent-loop/src/tasks.ts': 'правка цикла' },
};

describe('сторож в цикле', () => {
  it('обычная задача, тронувшая код цикла, — ожидание владельца, без ревью', async () => {
    const run = await runWorld({
      reviewFiles: 'M\ttools/agent-loop/src/tasks.ts\n',
      sessions: [TOUCH_LOOP],
    });
    expect(run.prompts).toHaveLength(1);
    expect(run.lines.join('\n')).toContain(`${TASK} изменила код цикла`);
    expect(run.lines.join('\n')).toContain('tools/agent-loop/src/tasks.ts');
    expect(run.lines).not.toContain(`готово: ${TASK}`);
  });

  it('обычная работа без правок цикла идёт на ревью как раньше', async () => {
    const ok: Session = { answer: 'OK\nвсё подтверждено', push: false };
    const run = await runWorld({
      reviewFiles: 'M\tapps/client/src/Hud.tsx\n',
      sessions: [{ answer: 'Готово.', commit: true, push: false }, ok],
    });
    expect(run.lines).toContain(`готово: ${TASK}`);
  });
});
