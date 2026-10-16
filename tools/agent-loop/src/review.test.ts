import { describe, expect, it } from 'vitest';

import { fixtureStage, runWorld, setMark, type Session } from './test-world.ts';

const TASK = '06/T1j5-Б1';
const TEST = 'tools/evolve/test/fitness.test.ts';
// После первого возврата исполнитель поменял в тесте только строки 10–14.
const DIFF = `diff --git a/${TEST} b/${TEST}
--- a/${TEST}
+++ b/${TEST}
@@ -10,3 +10,5 @@ describe('фитнес', () => {
+  a
`;

const NEXT_DONE: Session = { task: 'T1j5-Б1', mark: '~', answer: 'Готово.' };
const back = (remarks: string): Session => ({
  task: 'T1j5-Б1',
  mark: ' ',
  answer: `ВОЗВРАТ\n${remarks}`,
});
const FIRST_BACK = back(`- СПЕК: \`${TEST}:10-20\` не проверяет штраф чужого игрока`);
const UNCHANGED = `- СПЕК: \`${TEST}:40-45\` числа набора не совпадают с приёмкой`;
const REVIEW_OK: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'OK\nвсё подтверждено' };

describe('сходимость повторного ревью', () => {
  it('повторное ревью получает строки, изменённые после прошлого возврата', async () => {
    const run = await runWorld({
      reviewDiff: DIFF,
      sessions: [NEXT_DONE, FIRST_BACK, NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts[1]).not.toContain('Повторное ревью');
    expect(run.prompts[3]).toContain(`Повторное ревью: прошлый возврат — коммит c2.`);
    expect(run.prompts[3]).toContain(`${TEST}:10-14`);
    expect(run.lines).toContain(`готово: ${TASK}`);
  });

  it('возврат только из СПЕК к неизменённым строкам отклоняется: ревью заново, исполнитель не нужен', async () => {
    const run = await runWorld({
      reviewDiff: DIFF,
      sessions: [NEXT_DONE, FIRST_BACK, NEXT_DONE, back(UNCHANGED), REVIEW_OK],
    });
    expect(run.prompts).toHaveLength(5);
    expect(run.prompts[4]).toMatch(/^\$review 06\/T1j5-Б1\n/u);
    expect(run.prompts[4]).toContain('Цикл отклонил твой ВОЗВРАТ');
    expect(run.prompts[4]).toContain(UNCHANGED);
    expect(run.lines.join('\n')).toContain(`ВОЗВРАТ ${TASK} отклонён`);
    expect(run.lines).toContain(`готово: ${TASK}`);
    // Отклонённый возврат кругом не считается.
    expect(run.lines).not.toContain(`ВОЗВРАТ ${TASK}, круг 2 из 3`);
  });

  it('второй такой возврат подряд — ожидание владельца, а не новый круг исполнителя', async () => {
    const run = await runWorld({
      reviewDiff: DIFF,
      sessions: [NEXT_DONE, FIRST_BACK, NEXT_DONE, back(UNCHANGED), back(UNCHANGED)],
    });
    expect(run.prompts).toHaveLength(5);
    expect(run.lines.join('\n')).toContain(`ревью дважды вернуло ${TASK} только по строкам тестов`);
  });

  it('СПЕК к изменённым строкам — обычный возврат исполнителю', async () => {
    const inside = back(`- СПЕК: \`${TEST}:12\` проверка ослаблена`);
    const run = await runWorld({
      reviewDiff: DIFF,
      sessions: [NEXT_DONE, FIRST_BACK, NEXT_DONE, inside, NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts[4]).not.toContain('Цикл отклонил');
    expect(run.lines).toContain(`ВОЗВРАТ ${TASK}, круг 2 из 3`);
    expect(run.lines).toContain(`готово: ${TASK}`);
  });

  it('возврат с замечанием к продукту и лишним СПЕК идёт исполнителю целиком', async () => {
    const mixed = back(`${UNCHANGED}\n- evaluate.ts:95 — штраф по чужим метрикам`);
    const run = await runWorld({
      reviewDiff: DIFF,
      sessions: [NEXT_DONE, FIRST_BACK, NEXT_DONE, mixed, NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts.join('\n')).not.toContain('Цикл отклонил');
    expect(run.lines).toContain(`ВОЗВРАТ ${TASK}, круг 2 из 3`);
  });

  it('владелец изменил текст задачи после возврата — ревью целиком, новые СПЕК допустимы', async () => {
    const changed = setMark(
      fixtureStage.replace('*Приёмка:* тесты.', '*Приёмка:* тесты на два набора.'),
      'T1j5-Б1',
      '~',
    );
    const run = await runWorld({
      reviewDiff: DIFF,
      sessions: [
        NEXT_DONE,
        FIRST_BACK,
        { stage: changed, answer: 'Готово.' },
        back(UNCHANGED),
        NEXT_DONE,
        REVIEW_OK,
      ],
    });
    expect(run.prompts[3]).toContain('Текст задачи изменён после прошлого возврата');
    expect(run.prompts.join('\n')).not.toContain('Цикл отклонил');
    expect(run.lines).toContain(`готово: ${TASK}`);
  });
});

describe('отметка, которую ревью забыло сменить', () => {
  // 2026-10-16, 07/T17e и T17f: вердикт в ответе есть, а `[~]` в файле этапа остался.
  const FORGOT_OK: Session = { answer: 'OK\nвсё подтверждено' };
  const FIX_X: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'Отметка исправлена.' };

  it('OK без отметки [x]: одна короткая сессия правит отметку, задача готова', async () => {
    const run = await runWorld({ sessions: [NEXT_DONE, FORGOT_OK, FIX_X] });
    expect(run.prompts).toHaveLength(3);
    expect(run.prompts[2]).toContain('Исправление отметки после $review');
    expect(run.prompts[2]).toContain('«- [x]»');
    expect(run.lines).toContain(`готово: ${TASK}`);
  });

  it('ВОЗВРАТ без отметки [ ]: отметка исправляется на [ ], круг идёт дальше', async () => {
    const forgot: Session = { answer: 'ВОЗВРАТ\n- evaluate.ts:95 — штраф по чужим метрикам' };
    const fix: Session = { task: 'T1j5-Б1', mark: ' ', answer: 'Отметка исправлена.' };
    const run = await runWorld({ sessions: [NEXT_DONE, forgot, fix, NEXT_DONE, REVIEW_OK] });
    expect(run.prompts[2]).toContain('«- [ ]»');
    expect(run.lines).toContain(`ВОЗВРАТ ${TASK}, круг 1 из 3`);
    expect(run.lines).toContain(`готово: ${TASK}`);
  });

  it('просьба не помогла — ожидание владельца с понятной причиной, без третьей сессии', async () => {
    const run = await runWorld({
      sessions: [NEXT_DONE, FORGOT_OK, { answer: 'Не смог.' }],
    });
    expect(run.prompts).toHaveLength(3);
    expect(run.lines.join('\n')).toContain(
      'не совпадает с отметкой [~] даже после просьбы исправить',
    );
    expect(run.lines).not.toContain(`готово: ${TASK}`);
  });
});
