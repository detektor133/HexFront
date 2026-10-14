import { describe, expect, it } from 'vitest';

import { withUnlocked } from './spec.ts';
import type { LoopState } from './state.ts';
import { fixtureStage, runWorld, type Session } from './test-world.ts';

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
/** Работа после возврата ревью о тестах: исполнитель сам меняет приёмочный тест. */
const NEXT_FIXES_SPEC: Session = {
  ...NEXT_DONE,
  writes: { [TEST]: "it('штраф по метрикам самой особи на реальном пути', () => {});\n" },
};
const unlockedPrompt = (prompt: string, files: readonly string[] = [TEST]): string =>
  withUnlocked(prompt, '06/T1j5-Б1', files);

describe('приёмочные тесты до кода ($spec)', () => {
  it('пишет тесты сессией spec, исполнитель получает их закрытыми и коммитит с кодом', async () => {
    const run = await runWorld({ spec: true, sessions: [SPEC, NEXT_DONE, REVIEW_OK] });
    expect(run.prompts).toEqual([
      '$spec 06/T1j5-Б1',
      `$task 06/T1j5-Б1\n${LOCKED_LINE}`,
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
    expect(run.prompts).toEqual(['$spec 06/T1j5-Б1', `$task 06/T1j5-Б1\n${LOCKED_LINE}`]);
    expect(run.lines).toContain(`жду: исполнитель изменил приёмочный тест ${TEST}`);
  });

  it('остановка с вопросом убирает тесты из дерева: без доделки и без грязного дерева', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, { answer: 'Вопрос записан в docs/QUESTIONS.md', commit: false }],
    });
    expect(run.prompts).toEqual(['$spec 06/T1j5-Б1', `$task 06/T1j5-Б1\n${LOCKED_LINE}`]);
    expect(run.lines).toContain(
      'жду: 06/T1j5-Б1 не отмечена [~]: нужен владелец (вопрос, проверка или задача владельца)',
    );
    expect(run.lines.some((line) => line.includes('дерево не чистое'))).toBe(false);
  });

  it('ВОЗВРАТ с замечанием «СПЕК:» открывает тесты исполнителю: он их исправляет, $spec не повторяется', async () => {
    const back: Session = {
      task: 'T1j5-Б1',
      mark: ' ',
      answer: 'ВОЗВРАТ\n- СПЕК: тест не проверяет штраф чужого игрока (п. 3)',
    };
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, NEXT_DONE, back, NEXT_FIXES_SPEC, REVIEW_OK],
    });
    expect(run.prompts.filter((prompt) => prompt.startsWith('$spec'))).toHaveLength(1);
    expect(run.prompts[3]).toBe(unlockedPrompt('$task 06/T1j5-Б1'));
    expect(run.locked[3]).toBe('');
    expect(run.prompts[4]).toContain(
      `Приёмочные тесты задачи исправлял исполнитель по возврату «СПЕК:»: ${TEST}`,
    );
    expect(run.lines).toContain(
      'возврат ревью 06/T1j5-Б1 о приёмочных тестах — их исправляет исполнитель',
    );
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('промпт открытых тестов запрещает ослаблять проверки и заглушки ради теста', () => {
    const prompt = unlockedPrompt('$task 06/T1j5-Б1');
    expect(prompt).toContain('исправь их сам по замечанию');
    expect(prompt).toContain('проверки не ослабляй');
    expect(prompt).toContain('заглушек ради теста не добавляй');
  });

  it('обычный ВОЗВРАТ тесты не переписывает', async () => {
    const back: Session = { task: 'T1j5-Б1', mark: ' ', answer: 'ВОЗВРАТ\n- п.1 — нет обработки' };
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, NEXT_DONE, back, NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts.filter((prompt) => prompt.startsWith('$spec'))).toHaveLength(1);
    expect(run.prompts[3]).toBe(`$task 06/T1j5-Б1\n${LOCKED_LINE}`);
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

  // 2026-10-14, 07/T1: тест $spec падал на `window is not defined` и на порядке импортов,
  // исполнитель менять его не мог — задача встала.
  const BROKEN: Session = {
    answer:
      'Задача не закоммичена.\nСПЕК: fitness-own.test.ts — ReferenceError: window is not defined',
    writes: { 'packages/sim/src/fitness.ts': 'export const fitness = 1;\n' },
    commit: false,
  };
  const SPEC_FIX: Session = {
    answer: `Окружение заглушено.\nСПЕК: ${TEST}`,
    writes: { [TEST]: "it('штраф по метрикам самой особи, с заглушкой window', () => {});\n" },
    commit: false,
  };

  it('исполнитель сообщил о сломанном тесте — $spec чинит его, работа продолжается в том же дереве', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, BROKEN, SPEC_FIX, NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts[2]).toBe(
      '$spec 06/T1j5-Б1\nЗамечания к приёмочным тестам:\nИсполнитель задачи:\nСПЕК: fitness-own.test.ts — ReferenceError: window is not defined',
    );
    expect(run.prompts[3]).toBe(`$task 06/T1j5-Б1 продолжить\n${LOCKED_LINE}`);
    expect(run.prompts[4]).toBe(
      `$review 06/T1j5-Б1\nПриёмочные тесты задачи, написанные $spec до кода: ${TEST}`,
    );
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('то же замечание исполнителя к тестам после починки — ожидание владельца', async () => {
    const run = await runWorld({ spec: true, sessions: [SPEC, BROKEN, SPEC_FIX, BROKEN] });
    expect(run.prompts).toHaveLength(4);
    expect(run.lines).toContain(
      'жду: $spec не исправил приёмочные тесты 06/T1j5-Б1 по тому же замечанию — нужен владелец',
    );
  });

  it('ожидание владельца с работой в дереве не запускает доделку на следующих шагах цикла', async () => {
    // Задача пишется в память до сессии (на случай Ctrl+C): ожидание обязано её стереть,
    // иначе каждый шаг цикла снова запускал бы codex на том же дереве.
    const run = await runWorld({
      spec: true,
      polls: 3,
      wake: true,
      sessions: [SPEC, BROKEN, SPEC_FIX, BROKEN],
    });
    expect(run.prompts).toHaveLength(4);
    expect(
      run.lines.filter((line) => line.startsWith('жду: $spec не исправил приёмочные тесты')),
    ).toHaveLength(1);
  });

  it('разные замечания исполнителя чинятся по очереди: сначала окружение, потом нехватка проверки', async () => {
    // 2026-10-14, 07/T1: после починки `window` ревью нашло нехватку проверки геометрии,
    // а цикл счёл это повтором и встал.
    const missing: Session = {
      ...BROKEN,
      answer: `Не закоммичено.\nСПЕК: ${TEST} — нет проверки предела радиус + толщина линии`,
    };
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, BROKEN, SPEC_FIX, missing, SPEC_FIX, NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts.filter((p) => p.startsWith('$spec'))).toHaveLength(3);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('ВОЗВРАТ ревью, который ссылается на файл приёмочного теста без «СПЕК:», — тесты исправляет исполнитель', async () => {
    const back: Session = {
      task: 'T1j5-Б1',
      mark: ' ',
      answer: `ВОЗВРАТ\n- геометрия не подтверждена: ${TEST}:31-51 не записывает точки пути`,
    };
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, NEXT_DONE, back, NEXT_FIXES_SPEC, REVIEW_OK],
    });
    expect(run.prompts[3]).toBe(unlockedPrompt('$task 06/T1j5-Б1'));
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('исполнитель встал на возврате ревью про приёмочный тест — тест открывается, работа продолжается', async () => {
    // 2026-10-14, 07/T1 после перезапуска цикла: возврат лежит в блоке задачи, исполнитель
    // ответил «нельзя без изменения теста» без строки «СПЕК:».
    const stage = fixtureStage.replace(
      '  *Приёмка:* тесты.',
      '  *Приёмка:* тесты.\n  Возврат ревью: fitness-own.test.ts:31-51 не проверяет штраф чужого игрока.',
    );
    const stuck: Session = {
      answer: 'T1 выполнить без изменения теста нельзя. Нужно разрешить дополнить тест.',
      commit: false,
    };
    const run = await runWorld({
      spec: true,
      stage,
      sessions: [SPEC, stuck, NEXT_FIXES_SPEC, REVIEW_OK],
    });
    expect(run.prompts.filter((prompt) => prompt.startsWith('$spec'))).toHaveLength(1);
    expect(run.prompts[2]).toBe(unlockedPrompt('$task 06/T1j5-Б1 продолжить'));
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  // 2026-10-14, 07/T1: ревью вернуло задачу из-за приёмочного теста, цикл перезапустили —
  // замечание осталось только в блоке задачи, а `$next` со старым тестом взял 07/T2.
  const RETURN = '  Возврат ревью: fitness-own.test.ts:31-51 не проверяет штраф чужого игрока.';
  const returned = fixtureStage.replace('  *Приёмка:* тесты.', `  *Приёмка:* тесты.\n${RETURN}`);
  const LOCKED = { spec: { '06/T1j5-Б1': { [TEST]: "it('старый тест', () => {});\n" } } };

  it('после перезапуска возврат ревью о приёмочном тесте в блоке задачи — тесты открываются исполнителю', async () => {
    const run = await runWorld({
      spec: true,
      stage: returned,
      state: LOCKED,
      sessions: [NEXT_FIXES_SPEC, REVIEW_OK],
    });
    expect(run.prompts[0]).toBe(unlockedPrompt('$task 06/T1j5-Б1'));
    expect(run.lines).toContain(
      'возврат ревью 06/T1j5-Б1 о приёмочных тестах — их исправляет исполнитель',
    );
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('возврат, по которому $spec уже переписал тесты, не переписывает их снова', async () => {
    const run = await runWorld({
      spec: true,
      stage: returned,
      state: { ...LOCKED, specRepairNotes: { '06/T1j5-Б1': [RETURN.trim()] } },
      sessions: [NEXT_DONE],
    });
    expect(run.prompts).toEqual([`$task 06/T1j5-Б1\n${LOCKED_LINE}`]);
  });

  it('исполнитель остановился без «СПЕК:» после переписанных тестов — вопрос владельцу, а не $spec', async () => {
    // Строка возврата остаётся в блоке до коммита задачи: по ней тесты уже переписаны.
    const question: Session = {
      answer: 'Нужен ответ владельца: какой радиус дуги?',
      commit: false,
    };
    const run = await runWorld({
      spec: true,
      stage: returned,
      state: { ...LOCKED, specRepairNotes: { '06/T1j5-Б1': [RETURN.trim()] } },
      sessions: [question],
    });
    expect(run.prompts).toHaveLength(1);
    expect(run.lines).toContain(
      'жду: 06/T1j5-Б1 не отмечена [~]: нужен владелец (вопрос, проверка или задача владельца)',
    );
  });

  it('сессия прервана Ctrl+C до этой версии цикла — приёмочные тесты в дереве называют задачу для доделки', async () => {
    const run = await runWorld({
      spec: true,
      dirty: TEST,
      state: LOCKED,
      sessions: [NEXT_DONE],
    });
    expect(run.prompts[0]).toBe(`$task 06/T1j5-Б1 продолжить\n${LOCKED_LINE}`);
  });

  it('просьба переписать тесты от прежней версии цикла — тесты открыты исполнителю, $spec не запускается', async () => {
    // 2026-10-14, 07/T2 стоит с такой просьбой в state.json на ПК владельца.
    const OTHER = 'packages/sim/test/fitness-other.test.ts';
    const old = {
      specRewrite: {
        '06/T1j5-Б1': {
          remarks: 'ВОЗВРАТ\n- СПЕК: нет проверки штрафа чужого игрока',
          files: { [TEST]: "it('старый', () => {});\n", [OTHER]: "it('другой', () => {});\n" },
        },
      },
    } as unknown as Partial<LoopState>;
    const run = await runWorld({ spec: true, state: old, sessions: [NEXT_DONE, REVIEW_OK] });
    expect(run.prompts[0]).toBe(unlockedPrompt('$task 06/T1j5-Б1', [TEST, OTHER]));
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('ВОЗВРАТ без имени файла, но с возвратом о приёмочном тесте в блоке — тесты исправляет исполнитель', async () => {
    const back: Session = { stage: returned, answer: 'ВОЗВРАТ\n- геометрия не подтверждена' };
    const run = await runWorld({
      spec: true,
      sessions: [SPEC, NEXT_DONE, back, NEXT_FIXES_SPEC, REVIEW_OK],
    });
    expect(run.prompts[3]).toBe(unlockedPrompt('$task 06/T1j5-Б1'));
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('тесты $spec с ошибкой lint — цикл сам правит формат, остальное возвращает $spec один раз', async () => {
    const error = `${TEST}\n  3:1  error  'x' is assigned a value but never used  no-unused-vars`;
    const run = await runWorld({
      spec: true,
      lint: [error, 'ok'],
      sessions: [SPEC, SPEC, NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts[1]).toBe(
      `$spec 06/T1j5-Б1\nЗамечания к приёмочным тестам:\nlint тестов (порядок импортов и формат цикл уже поправил):\n${error}`,
    );
    expect(run.execs).toContain(`eslint --fix ${TEST}`);
    expect(run.execs).toContain(`prettier --write ${TEST}`);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('тесты $spec дважды не проходят lint — ожидание владельца, исполнитель не запускается', async () => {
    const run = await runWorld({ spec: true, lint: ['ошибка', 'ошибка'], sessions: [SPEC, SPEC] });
    expect(run.prompts.filter((p) => !p.startsWith('$spec'))).toEqual([]);
    expect(run.lines).toContain('жду: приёмочные тесты 06/T1j5-Б1 не проходят lint');
  });

  it('без роли spec в roles.json цикл работает по-старому', async () => {
    const run = await runWorld({ sessions: [NEXT_DONE, REVIEW_OK] });
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
  });
});
