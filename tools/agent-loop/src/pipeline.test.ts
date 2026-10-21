import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadState } from './state.ts';
import { fixtureStage, runWorld, setMark, type Session } from './test-world.ts';

describe('конвейер кода и тестов', () => {
  it('отделяет код от тестов и проверяет тесты до финального CI', async () => {
    const done: Session = {
      task: 'T1j5-Б1',
      mark: '~',
      answer: 'Тесты и код добавлены одним коммитом.',
    };
    const codeReview: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'Код принят.' };
    const tests: Session = {
      answer: 'Тесты добавлены.',
      writes: { 'packages/sim/test/task.test.ts': "it('путь', () => {});\n" },
      commit: true,
    };
    const testReview: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'Тесты приняты.' };
    const run = await runWorld({
      plan: true,
      test: true,
      sessions: [{ answer: 'PLAN: не трогал' }, done, codeReview, tests, testReview],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$plan 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$tests 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.roles).toEqual(['plan', '', 'reviewer', 'spec', 'reviewer']);
    expect(run.locked).toEqual(['', '', '', '', '']);
    expect(run.ciCalls).toBe(1);
  });

  it('возвращает дефект из тестов исполнителю коротким пакетом КОД', async () => {
    const done: Session = { task: 'T1j5-Б1', mark: '~', answer: 'Код готов.' };
    const codeReview: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'Код принят.' };
    const tests: Session = { answer: 'Тесты добавлены.', commit: true };
    const defect: Session = {
      task: 'T1j5-Б1',
      mark: ' ',
      answer: 'ВОЗВРАТ\n- КОД: п. 2 — путь не отправляет команду, MatchSurfaceRuntime.tsx:41',
    };
    const run = await runWorld({
      test: true,
      sessions: [done, codeReview, tests, defect, done, codeReview, tests, codeReview],
    });

    const repair = run.prompts.find((prompt) => prompt.includes('ОБЯЗАТЕЛЬНЫЙ ВОЗВРАТ REVIEWER'));
    expect(repair).toContain('КОД: п. 2');
    expect(repair).not.toContain('ТЕСТ:');
  });

  it('после перезапуска продолжает автора тестов, а не выбирает новую задачу', async () => {
    const tests: Session = { answer: 'Тесты добавлены.', commit: true };
    const review: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'Тесты приняты.' };
    const run = await runWorld({
      test: true,
      stage: setMark(fixtureStage, 'T1j5-Б1', 'x'),
      state: { testPhase: { '06/T1j5-Б1': 'write' } },
      sessions: [tests, review],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$tests 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
  });

  it('сам коммитит тест автора и передаёт его reviewer, даже если автор не закоммитил', async () => {
    const tests: Session = {
      answer: 'Тест написан и выявил дефект.',
      writes: { 'packages/sim/test/task.test.ts': "it('путь', () => {});\n" },
    };
    const review: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'Тесты приняты.' };
    const run = await runWorld({
      test: true,
      stage: setMark(fixtureStage, 'T1j5-Б1', 'x'),
      state: { testPhase: { '06/T1j5-Б1': 'write' } },
      sessions: [tests, review],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$tests 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.pushes).toBe(1);
  });

  it('загружает старые поля ручного $spec без влияния на очередь', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hexfront-state-'));
    try {
      const path = join(root, '.ai-logs', 'agent-loop', 'state.json');
      await mkdir(join(root, '.ai-logs', 'agent-loop'), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          spec: { '07/T1': {} },
          specUnlocked: { '07/T1': [] },
          specRepairNotes: { '07/T1': [] },
        }),
        'utf8',
      );
      const state = await loadState(root);

      expect(state.spec).toEqual({ '07/T1': {} });
      expect(state.specUnlocked).toEqual({ '07/T1': [] });
      expect(state.specRepairNotes).toEqual({ '07/T1': [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
