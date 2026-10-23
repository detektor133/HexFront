import { describe, expect, it } from 'vitest';

import { verifyPlanTransition } from './requirements.ts';
import { taskBlock } from './stage-file.ts';
import { fixtureStage, fixtureStatus, runWorld, setMark, type Session } from './test-world.ts';

const TASK = '06/T1j5-Б1';
const NEXT_DONE: Session = { task: 'T1j5-Б1', mark: '~', answer: 'Готово.' };
const REVIEW_OK: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'OK\nвсё подтверждено' };
const PLAN_UNTOUCHED: Session = {
  answer: 'Текст достаточный, числа и путь есть.\nPLAN: не трогал',
};
const commands = (prompts: readonly string[]): string[] =>
  prompts.map((prompt) => prompt.split('\n')[0] ?? '');

describe('роль plan перед исполнением задачи', () => {
  it('принимает уточнение отдельным блоком без изменения исходного текста', () => {
    const before = [
      '# Этап 07',
      '- [ ] **T17w. ArmyBar** (`ArmyBar.module.css`, при необходимости `ArmyBar.tsx`, связанные тесты).',
      'Карточки, резерв, приказы, кнопки и прокрутка остаются рабочими. Ширина карточки 238 px, вертикального скролла нет.',
      '',
      '### Трассировка',
      '| Требование | Задача |',
    ].join('\n');
    const after = [
      '# Этап 07',
      '- [ ] **T17w. ArmyBar** (`ArmyBar.module.css`, при необходимости `ArmyBar.tsx`, связанные тесты).',
      'Карточки, резерв, приказы, кнопки и прокрутка остаются рабочими. Ширина карточки 238 px, вертикального скролла нет.',
      '',
      '*Уточнение plan:* пути: `apps/client/src/dev/ArmyBar.module.css`, `apps/client/src/dev/ArmyBar.tsx`, `army-bar-layout.test.ts`; элементы: карточки армий, «Резерв» и кнопки приказов.',
      '',
      '### Трассировка',
      '| Требование | Задача |',
    ].join('\n');

    expect(
      verifyPlanTransition(
        '07/T17w',
        { stageText: before, status: fixtureStatus },
        { stageText: after, status: fixtureStatus },
        'уточнено',
      ),
    ).toEqual([]);
  });

  it('принимает добавление уточнения после нормализации отступа прежней строки', () => {
    const before = [
      '# Этап 07',
      '- [ ] **T17at. Лента событий**.',
      '  *Приёмка:* различать захват и потерю.',
      '  *Уточнение plan:* передать `localPlayerId`.',
    ].join('\n');
    const after = [
      '# Этап 07',
      '- [ ] **T17at. Лента событий**.',
      '  *Приёмка:* различать захват и потерю.',
      '*Уточнение plan:* передать `localPlayerId`.',
      '*Уточнение plan:* сравнить точные подписи.',
    ].join('\n');

    expect(
      verifyPlanTransition(
        '07/T17at',
        { stageText: before, status: fixtureStatus },
        { stageText: after, status: fixtureStatus },
        'уточнено',
      ),
    ).toEqual([]);
  });

  it('не принимает перефразирование исходного текста, даже если смысл похож', () => {
    const before = '# Этап 07\n- [ ] **T17t. HUD**.\nПриёмка: остальные иконки не изменены.\n';
    const after =
      '# Этап 07\n- [ ] **T17t. HUD**.\nПриёмка: у остальных иконок сохранены `fill` и `stroke`.\n';
    expect(
      verifyPlanTransition(
        '07/T17t',
        { stageText: before, status: fixtureStatus },
        { stageText: after, status: fixtureStatus },
        'уточнено',
      ),
    ).toEqual(['при уточнении изменена или удалена исходная строка; разрешено только добавление']);
  });

  it('не принимает добавление без маркированного блока уточнения', () => {
    const before = '# Этап 07\n- [ ] **T17u. Регрессия**.\nПриёмка: тесты.\n';
    const after = `${before.trimEnd()}\nДополнительно проверить три уведомления.\n`;
    expect(
      verifyPlanTransition(
        '07/T17u',
        { stageText: before, status: fixtureStatus },
        { stageText: after, status: fixtureStatus },
        'уточнено',
      ),
    ).toEqual(['добавление должно начинаться с «*Уточнение plan:*»']);
  });

  it('без роли plan в roles.json цикл работает по-старому', async () => {
    const run = await runWorld({ sessions: [NEXT_DONE, REVIEW_OK] });
    expect(commands(run.prompts)).toEqual([`$task ${TASK}`, `$review ${TASK}`]);
  });

  it('текст уже годный — plan его не трогает, задача идёт исполнителю как обычно', async () => {
    const run = await runWorld({ plan: true, sessions: [PLAN_UNTOUCHED, NEXT_DONE, REVIEW_OK] });
    expect(commands(run.prompts)).toEqual([`$plan ${TASK}`, `$task ${TASK}`, `$review ${TASK}`]);
    expect(run.roles).toEqual(['plan', '', 'reviewer']);
    expect(run.lines).toContain(`$plan ${TASK}: не трогал`);
    expect(run.lines).toContain(`готово: ${TASK}`);
  });

  it('принимает итоговый маркер plan в Markdown-коде', async () => {
    const run = await runWorld({
      plan: true,
      sessions: [{ answer: 'Текст достаточный.\n`PLAN: не трогал`' }, NEXT_DONE, REVIEW_OK],
    });

    expect(commands(run.prompts)).toEqual([`$plan ${TASK}`, `$task ${TASK}`, `$review ${TASK}`]);
    expect(run.lines).toContain(`$plan ${TASK}: не трогал`);
  });

  it('технический блокер передаёт исполнителю без ожидания владельца', async () => {
    const run = await runWorld({
      plan: true,
      sessions: [
        { answer: 'PLAN: инфраструктура — реальную CSS-геометрию проверить через Playwright' },
        NEXT_DONE,
        REVIEW_OK,
      ],
    });

    expect(commands(run.prompts)).toEqual([`$plan ${TASK}`, `$task ${TASK}`, `$review ${TASK}`]);
    expect(run.prompts[1]).toContain(
      'Сначала устрани технический блокер без участия владельца: реальную CSS-геометрию проверить через Playwright',
    );
    expect(run.lines).not.toContain(expect.stringContaining('ждёт ответа владельца'));
  });

  it('plan уточняет формулировку без ослабления — исполнитель получает новый текст той же задачи', async () => {
    const clarified = setMark(
      fixtureStage.replace(
        '*Приёмка:* тесты.',
        '*Приёмка:* тесты.\n  *Уточнение plan:* дополнительно проверить 2 критерия (п.1, п.2).',
      ),
      'T1j5-Б1',
      ' ',
    );
    const planFix: Session = {
      answer: 'Критерий «тесты» уточнён числом из текста задачи.\nPLAN: уточнено',
      stage: clarified,
      commit: true,
      files: ['docs/stages/stage-06-bots-balance.md', 'docs/DECISIONS.md'],
    };
    const run = await runWorld({ plan: true, sessions: [planFix, NEXT_DONE, REVIEW_OK] });
    expect(commands(run.prompts)).toEqual([`$plan ${TASK}`, `$task ${TASK}`, `$review ${TASK}`]);
    expect(run.lines).toContain(`$plan ${TASK}: уточнено`);
    expect(run.lines).toContain(`готово: ${TASK}`);
  });

  it('plan разбивает задачу — исполнитель получает первую подзадачу', async () => {
    const split = fixtureStage.replace(
      '- [ ] **T1j5-Б1. Фитнес по метрикам самой особи** (tools/evolve).\n  *Приёмка:* тесты.',
      '- [ ] **T1j5-Б1. Фитнес по метрикам самой особи** (tools/evolve).\n  *Приёмка:* тесты.\n' +
        '- [ ] **T1j5-Б1a. Часть первая** (tools/evolve).\n  *Приёмка:* тесты.\n' +
        '- [ ] **T1j5-Б1b. Часть вторая** (tools/evolve).\n  *Проверка:* интеграция.',
    );
    const splitStatus = fixtureStatus.replace(
      'Очередь: 06/T1j5-Б1 → 06/T1i → 06/T1e',
      'Очередь: 06/T1j5-Б1a → 06/T1j5-Б1b → 06/T1i → 06/T1e',
    );
    const planSplit: Session = {
      answer: 'Задача больше одной подсистемы — разбита на 2 подзадачи.\nPLAN: разбито',
      stage: split,
      status: splitStatus,
      commit: true,
      files: ['docs/stages/stage-06-bots-balance.md', 'docs/STATUS.md', 'docs/DECISIONS.md'],
    };
    const workDone: Session = { task: 'T1j5-Б1a', mark: '~', answer: 'Готово.' };
    const reviewOk: Session = { task: 'T1j5-Б1a', mark: 'x', answer: 'OK\nвсё подтверждено' };
    // После первой подзадачи очередь доходит до второй: plan проверяет и её текст — каждый шаг
    // очереди, а не только разбитую исходную задачу. Вторую подзадачу дальше не доводим до конца —
    // важен только порядок первых шагов.
    const planB: Session = { answer: 'Текст второй подзадачи достаточен.\nPLAN: не трогал' };
    const run = await runWorld({
      plan: true,
      maxRounds: 1,
      sessions: [planSplit, workDone, reviewOk, planB, { answer: 'Готово.', commit: false }],
    });
    expect(commands(run.prompts).slice(0, 4)).toEqual([
      `$plan ${TASK}`,
      '$task 06/T1j5-Б1a',
      '$review 06/T1j5-Б1a',
      '$plan 06/T1j5-Б1b',
    ]);
    expect(run.lines).toContain(`$plan ${TASK}: разбито`);
    expect(run.lines).toContain('готово: 06/T1j5-Б1a');
    expect(run.lines).toContain('$plan 06/T1j5-Б1b: не трогал');
  });

  it('plan удалил приёмку — блокирует $task, даже если ответил «уточнено»', async () => {
    const bad = fixtureStage.replace('  *Приёмка:* тесты.', '  *Приёмка:* отключить проверки.');
    const run = await runWorld({
      plan: true,
      sessions: [{ answer: 'PLAN: уточнено', stage: bad, commit: true }],
    });
    expect(run.prompts).toEqual([`$plan ${TASK}`]);
    expect(run.lines.some((line) => line.includes('сверка требований не пройдена'))).toBe(true);
  });

  it('plan назвал удаление задачи разбиением — блокирует исполнителя', async () => {
    const bad = fixtureStage.replace(
      /^- \[\x20\] \*\*T1j5-Б1\.[^\n]*\n\s{2}\*Приёмка:\* тесты\.\n/mu,
      '',
    );
    const run = await runWorld({
      plan: true,
      sessions: [{ answer: 'PLAN: разбито', stage: bad, commit: true }],
    });
    expect(run.prompts).toEqual([`$plan ${TASK}`]);
    expect(run.lines.some((line) => line.includes('сверка требований не пройдена'))).toBe(true);
  });

  it('plan не находит ответа в доках — вопрос в QUESTIONS.md, задача не передаётся $task', async () => {
    const planQuestion: Session = {
      answer: 'Нет ответа в доках про радиус дуги.\nPLAN: вопрос',
      writes: { 'docs/QUESTIONS.md': '# Открытые вопросы\n\n- вопрос про радиус дуги\n' },
      commit: true,
      files: ['docs/QUESTIONS.md'],
    };
    const run = await runWorld({ plan: true, sessions: [planQuestion] });
    expect(run.prompts).toEqual([`$plan ${TASK}`]);
    expect(run.lines).toContain(`$plan ${TASK}: вопрос`);
    // Следующая задача очереди — 06/T1i, она задача владельца: цикл до неё дошёл сам.
    expect(run.lines.some((line) => line.includes('очередь дошла до 06/T1i'))).toBe(true);
  });

  it('все задачи очереди заблокированы вопросом plan — ожидание владельца', async () => {
    const status =
      '# Статус\n\n| Текущий этап | 06 — тестовый этап |\n| Ветка | `stage-06` |\n\nОчередь: 06/T1\n';
    const stage = '# Этап 06\n\n- [ ] **T1. Задача**, не задача владельца.\n  *Приёмка:* тесты.\n';
    const planQuestion: Session = {
      answer: 'Нет ответа в доках.\nPLAN: вопрос',
      writes: { 'docs/QUESTIONS.md': '# Открытые вопросы\n\n- вопрос\n' },
      commit: true,
      files: ['docs/QUESTIONS.md'],
    };
    const run = await runWorld({ plan: true, status, stage, sessions: [planQuestion] });
    expect(run.prompts).toEqual(['$plan 06/T1']);
    expect(run.lines).toContain(
      'жду: все задачи очереди ждут ответа владельца на вопрос plan в docs/QUESTIONS.md',
    );
  });

  it('заблокированная задача с неизменным текстом не проверяется plan повторно', async () => {
    const snapshot = taskBlock(fixtureStage, TASK);
    const run = await runWorld({
      plan: true,
      state: { planBlocked: { [TASK]: snapshot } },
      sessions: [],
    });
    expect(run.prompts).toEqual([]);
    expect(run.lines.some((line) => line.includes('очередь дошла до 06/T1i'))).toBe(true);
  });

  it('владелец изменил блок задачи — блок снимается, plan проверяет заново', async () => {
    const stale = setMark(
      fixtureStage.replace('*Приёмка:* тесты.', '*Приёмка:* другой текст.'),
      'T1j5-Б1',
      ' ',
    );
    const run = await runWorld({
      plan: true,
      state: { planBlocked: { [TASK]: stale } },
      sessions: [PLAN_UNTOUCHED, NEXT_DONE, REVIEW_OK],
    });
    expect(commands(run.prompts)).toEqual([`$plan ${TASK}`, `$task ${TASK}`, `$review ${TASK}`]);
    expect(run.lines).toContain(`готово: ${TASK}`);
  });

  it('plan не ответил строкой «PLAN: …» — ожидание владельца', async () => {
    const run = await runWorld({ plan: true, sessions: [{ answer: 'Всё хорошо.' }] });
    expect(run.lines).toContain(`жду: $plan ${TASK} не ответил строкой «PLAN: …» — проверь`);
  });

  it('plan оставил незакоммиченные файлы — ожидание владельца', async () => {
    const run = await runWorld({
      plan: true,
      sessions: [{ answer: 'PLAN: не трогал', dirty: true }],
    });
    expect(run.lines).toContain(`жду: $plan ${TASK} оставил незакоммиченные файлы — проверь`);
  });

  it('plan вышел за свои права — ожидание владельца', async () => {
    const run = await runWorld({
      plan: true,
      sessions: [
        {
          answer: 'PLAN: уточнено',
          writes: { 'packages/sim/src/step.ts': 'export {};\n' },
          commit: true,
          files: ['packages/sim/src/step.ts'],
        },
      ],
    });
    expect(run.lines).toContain(
      `жду: $plan ${TASK} вышел за свои права (изменил файлы вне permissions.json) — проверь коммит`,
    );
  });
});
