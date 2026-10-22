import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Board, MAIN_AGENT } from './board.ts';
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
      answer: 'Исправлен второй пункт.\nРЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
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
    expect(run.verifyCalls).toBe(1);
  });

  it('не отправляет красный repair-spec на review и не повторяет его автоматически', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        review('ВОЗВРАТ\n- ТЕСТ: тест пропускает нулевой размер'),
        {
          answer: 'РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
          writes: { 'packages/sim/test/task.test.ts': "it('ноль запрещён', () => {});\n" },
          commit: true,
          push: false,
        },
      ],
      verify: ['verify: FAIL'],
    });

    expect(run.prompts.filter((prompt) => prompt.startsWith('$review'))).toHaveLength(1);
    expect(run.verifyCalls).toBe(1);
    expect(run.lines).toContain(
      'жду: 06/T1j5-Б1: repair-$spec оставил красный verify --changed; повтор и review запрещены',
    );
  });

  it('передаёт красный усиленный тест кодеру без лишнего review', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        review('ВОЗВРАТ\n- ТЕСТ: тест не ловит переполнение'),
        {
          answer:
            'РЕМОНТ: КОД — усиленный тест выявил переполнение\nСПЕК: packages/sim/test/task.test.ts',
          writes: { 'packages/sim/test/task.test.ts': "it('переполнение', () => {});\n" },
          commit: true,
          push: false,
        },
        codeCommit('Исправлено переполнение.'),
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$spec 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$spec 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[4]).toContain('КОД: усиленный тест выявил переполнение');
    expect(run.verifyCalls).toBe(0);
  });

  it('после первого повторного возврата зовёт plan, после второго останавливается', async () => {
    const finding = 'ТЕСТ: тест не проверяет границы';
    const run = await runWorld({
      spec: true,
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'target-review',
          findings: [{ kind: 'ТЕСТ', text: finding }],
        },
      },
      sessions: [
        review(`ВОЗВРАТ\n- ${finding}`),
        { answer: 'PLAN: не трогал', push: false },
        {
          answer: 'РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
          writes: { 'packages/sim/test/task.test.ts': "it('границы', () => {});\n" },
          commit: true,
          push: false,
        },
        review(`ВОЗВРАТ\n- ${finding}`),
      ],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$review 06/T1j5-Б1',
      '$plan 06/T1j5-Б1',
      '$spec 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.lines).toContain(
      'жду: 06/T1j5-Б1: один пункт дважды не принят узким review; автоматический повтор запрещён',
    );
  });

  it('не запускает роль повторно для припаркованной активной задачи', async () => {
    const reason = '06/T1j5-Б1: критерий требует решения владельца после диагностики plan';
    const board = new Board(() => 0);
    const run = await runWorld({
      board,
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'ПЛАН', text: 'ПЛАН: jsdom не вычисляет геометрию CSS' }],
        },
        parked: { key: 'plan:06/T1j5-Б1', head: 'c0', reason },
      },
      sessions: [],
    });

    expect(run.prompts).toEqual([]);
    expect(run.lines).not.toContain(`жду: ${reason}`);
    expect(board.agents().find((agent) => agent.name === MAIN_AGENT)).toMatchObject({
      phase: 'wait',
      task: '06/T1j5-Б1',
      text: reason,
    });
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
          answer: 'Тест исправлен.\nРЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
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
