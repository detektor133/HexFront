import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadState } from './state.ts';
import { fixtureStage, runWorld, setMark, type Session } from './test-world.ts';

const codeCommit = (answer = 'Код готов.'): Session => ({
  answer,
  writes: { 'packages/sim/src/task.ts': 'export const task = true;\n' },
  commit: true,
  push: false,
});
const review = (answer: string): Session => ({ answer, push: false });

describe('последовательный конвейер задачи', () => {
  it('пишет тест до кода, push делает после review и отдельно фиксирует статус', async () => {
    const spec: Session = {
      answer: 'Приёмочный тест записан.',
      writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
      push: false,
    };
    const run = await runWorld({
      spec: true,
      sessions: [spec, codeCommit(), review('OK')],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$spec 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.roles).toEqual(['spec', '', 'reviewer']);
    expect(run.pushes).toBe(2);
    expect(run.ciCalls).toBe(2);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('выдаёт дефекты по одному и после каждого запускает узкий review', async () => {
    const returned = review(
      'ВОЗВРАТ\n- КОД: критерий 1 — неверный путь, packages/sim/src/task.ts:1\n- ТЕСТ: критерий 2 — нет края, packages/sim/test/task.test.ts:1',
    );
    const codeFix: Session = {
      answer: 'Исправлен первый пункт.',
      writes: { 'packages/sim/src/task.ts': 'export const task = false;\n' },
      commit: true,
      push: false,
    };
    const testFix: Session = {
      answer: 'Исправлен второй пункт.',
      writes: { 'packages/sim/test/task.test.ts': "it('край', () => {});\n" },
      commit: true,
      push: false,
    };
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        returned,
        codeFix,
        review('OK'),
        testFix,
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$spec 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$spec 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[3]).toContain('Исправь ровно один пункт reviewer');
    expect(run.prompts[3]).toContain('КОД: критерий 1');
    expect(run.prompts[3]).not.toContain('ТЕСТ: критерий 2');
    expect(run.prompts[5]).toContain('ТЕСТ: критерий 2');
    expect(run.prompts[4]).toContain('Узкая проверка');
    expect(run.prompts[7]).toContain('Финальный полный review');
  });

  it('останавливает задачу, если исполнитель push-нул до review', async () => {
    const run = await runWorld({ sessions: [{ ...codeCommit(), push: true }] });

    expect(run.prompts).toHaveLength(1);
    expect(run.lines).toContain('жду: 06/T1j5-Б1: рабочая сессия изменила origin до review');
    expect(run.ciCalls).toBe(0);
  });

  it('передаёт замечание кодера СПЕК отдельному автору тестов', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        { answer: 'СПЕК: packages/sim/test/task.test.ts:1 — проверяется неверное значение' },
        {
          answer: 'Тест исправлен.',
          writes: { 'packages/sim/test/task.test.ts': "it('верный критерий', () => {});\n" },
          commit: true,
          push: false,
        },
        review('OK'),
        codeCommit(),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[2]).toContain('$spec 06/T1j5-Б1');
    expect(run.prompts[2]).toContain('ТЕСТ: неверный приёмочный тест');
    expect(run.lines).not.toContain('нужен ответ владельца');
  });

  it('после перезапуска на docs-ci не создаёт служебный коммит повторно', async () => {
    const run = await runWorld({
      stage: setMark(fixtureStage, 'T1j5-Б1', 'x'),
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'docs-ci',
          findings: [],
        },
      },
      sessions: [],
      ci: ['success https://ci/docs'],
    });

    expect(run.prompts).toEqual([]);
    expect(run.pushes).toBe(0);
    expect(run.ciCalls).toBe(1);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('после перезапуска завершает оборванную финализацию', async () => {
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'finalize',
          findings: [],
        },
      },
      sessions: [],
      ci: ['success https://ci/docs'],
    });

    expect(run.prompts).toEqual([]);
    expect(run.pushes).toBe(1);
    expect(run.ciCalls).toBe(1);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('загружает старые поля state без влияния на новый автомат', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hexfront-state-'));
    try {
      const path = join(root, '.ai-logs', 'agent-loop', 'state.json');
      await mkdir(join(root, '.ai-logs', 'agent-loop'), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({ testPhase: { '07/T1': 'write' }, reviewFeedback: { '07/T1': 'старое' } }),
        'utf8',
      );
      const state = await loadState(root);

      expect(state.activeTask).toBeUndefined();
      expect('testPhase' in state).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
