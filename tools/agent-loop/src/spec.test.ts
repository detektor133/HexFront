import { describe, expect, it } from 'vitest';

import { runWorld, type Session } from './test-world.ts';

const TEST = 'packages/sim/test/fitness-own.test.ts';
const LOCKED_LINE = `Приёмочные тесты 06/T1j5-Б1 уже в рабочем дереве, менять их нельзя: ${TEST}`;
const SPEC: Session = {
  answer: `Тесты по 2 критериям.\nСПЕК: ${TEST}`,
  writes: { [TEST]: "it('штраф по метрикам самой особи', () => {});\n" },
  commit: false,
};
const NEXT_DONE: Session = {
  task: 'T1j5-Б1',
  mark: '~',
  answer: 'Готово.\nЗапусти `$review 06/T1j5-Б1` в новой сессии',
};
const REVIEW_OK: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'OK\nвсё подтверждено' };

describe('приёмочные тесты до кода ($spec)', () => {
  it('пишет тесты сессией spec, исполнитель получает их закрытыми и коммитит с кодом', async () => {
    const run = await runWorld({ spec: true, sessions: [SPEC, NEXT_DONE, REVIEW_OK] });
    expect(run.prompts).toEqual([
      '$spec 06/T1j5-Б1',
      `$next\n${LOCKED_LINE}`,
      `$review 06/T1j5-Б1\nПриёмочные тесты задачи, написанные $spec до кода: ${TEST}`,
    ]);
    expect(run.roles).toEqual(['spec', '', 'reviewer']);
    expect(run.locked).toEqual(['', TEST, '']);
    expect(run.lines).toContain(`приёмочные тесты 06/T1j5-Б1: ${TEST}`);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('исполнитель изменил приёмочный тест — ожидание владельца, а не ревью', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, { ...NEXT_DONE, writes: { [TEST]: "it.skip('ослаблен', () => {});\n" } }],
    });
    expect(run.prompts).toEqual(['$spec 06/T1j5-Б1', `$next\n${LOCKED_LINE}`]);
    expect(run.lines).toContain(`жду: исполнитель изменил приёмочный тест ${TEST}`);
  });

  it('остановка с вопросом убирает тесты из дерева: без доделки и без грязного дерева', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, { answer: 'Вопрос записан в docs/QUESTIONS.md', commit: false }],
    });
    expect(run.prompts).toEqual(['$spec 06/T1j5-Б1', `$next\n${LOCKED_LINE}`]);
    expect(run.lines).toContain(
      'жду: 06/T1j5-Б1 не отмечена [~]: нужен владелец (вопрос, проверка или задача владельца)',
    );
    expect(run.lines.some((line) => line.includes('дерево не чистое'))).toBe(false);
  });

  it('ВОЗВРАТ с замечанием «СПЕК:» пишет тесты заново с замечаниями ревью', async () => {
    const back: Session = {
      task: 'T1j5-Б1',
      mark: ' ',
      answer: 'ВОЗВРАТ\n- СПЕК: тест не проверяет штраф чужого игрока (п. 3)',
    };
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, NEXT_DONE, back, SPEC, NEXT_DONE, REVIEW_OK],
    });
    expect(
      run.prompts[3]?.startsWith(
        '$spec 06/T1j5-Б1\nЗамечания ревью к приёмочным тестам:\nВОЗВРАТ\n- СПЕК: тест не проверяет штраф чужого игрока (п. 3)',
      ),
    ).toBe(true);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('обычный ВОЗВРАТ тесты не переписывает', async () => {
    const back: Session = { task: 'T1j5-Б1', mark: ' ', answer: 'ВОЗВРАТ\n- п.1 — нет обработки' };
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, NEXT_DONE, back, NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts.filter((prompt) => prompt.startsWith('$spec'))).toHaveLength(1);
    expect(run.prompts[3]).toBe(`$next\n${LOCKED_LINE}`);
  });

  it('spec не пишет код: файл вне тестов — ожидание владельца', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [{ ...SPEC, writes: { 'packages/sim/src/step.ts': 'export {};\n' } }],
    });
    expect(run.prompts).toEqual(['$spec 06/T1j5-Б1']);
    expect(run.lines.some((line) => line.includes('вышел за свои права'))).toBe(true);
  });

  it('без тестируемых критериев — обычный $next без закрытых файлов', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [{ answer: 'СПЕК: нет', commit: false }, NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts).toEqual(['$spec 06/T1j5-Б1', '$next', '$review 06/T1j5-Б1']);
    expect(run.lines).toContain('приёмочные тесты 06/T1j5-Б1: нет (критерии не для тестов)');
  });

  it('без роли spec в roles.json цикл работает по-старому', async () => {
    const run = await runWorld({ sessions: [NEXT_DONE, REVIEW_OK] });
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
  });
});
