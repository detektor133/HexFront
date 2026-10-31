import { describe, expect, it } from 'vitest';

import { restoreMissingSplitParent, verifyPlanTransition, verifySplit } from './requirements.ts';
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
  it('не включает следующий раздел в исходную задачу при разбиении последней задачи', () => {
    const parent =
      '- [ ] **T17bs. Деление**.\n  Кнопка делит отряд.\n  *Приёмка:* тест кнопки и жеста.\n\n';
    const section = '## Завершённые задачи\n\n- [x] **T1. Основа**.\n';
    const children = [
      '- [ ] **T17bsa. Кнопка**.\n  Кнопка делит отряд.\n  *Приёмка:* тест кнопки.\n',
      '- [ ] **T17bsb. Жест**.\n  *Приёмка:* тест жеста.\n',
      '| Исходная строка T17bs | Подзадача |\n| --- | --- |\n',
      '| Кнопка делит отряд | T17bsa |\n| *Приёмка:* тест кнопки и жеста. | T17bsa; T17bsb |\n\n',
    ].join('\n');
    expect(taskBlock(parent + section, '07/T17bs')).toBe(parent);
    expect(
      verifySplit(
        '07/T17bs',
        { stageText: parent + section, status: 'Очередь: 07/T17bs' },
        {
          stageText: parent + children + section,
          status: 'Очередь: 07/T17bsa → 07/T17bsb',
        },
      ),
    ).toEqual([]);
  });
  it('принимает трассировку разбиения с заголовком «Исходный текст»', () => {
    const parent = [
      '- [ ] **T17bd. Список отрядов**.',
      '  Показать группы и строки выбранных отрядов.',
      '  *Приёмка:* DOM-тест проверяет группы и переключение выбора. Playwright проверяет размер кнопок.',
      '',
    ].join('\n');
    const children = [
      '- [ ] **T17bda. Группы**.',
      '  Показать группы и строки выбранных отрядов.',
      '  *Приёмка:* DOM-тест проверяет группы.',
      '',
      '- [ ] **T17bdb. Выбор**.',
      '  *Приёмка:* DOM-тест проверяет переключение выбора.',
      '',
      '- [ ] **T17bdc. Геометрия**.',
      '  *Приёмка:* Playwright проверяет размер кнопок.',
      '',
      'Трассировка разбиения T17bd:',
      '',
      '| Исходный текст | Подзадача |',
      '| --- | --- |',
      '| Группы и строки | 07/T17bda |',
      '| Переключение выбора | 07/T17bdb |',
      '| Размер кнопок | 07/T17bdc |',
      '',
    ].join('\n');
    expect(
      verifySplit(
        '07/T17bd',
        { stageText: parent, status: 'Очередь: 07/T17bd' },
        {
          stageText: parent + children,
          status: 'Очередь: 07/T17bda → 07/T17bdb → 07/T17bdc',
        },
      ),
    ).toEqual([]);
  });
  it('не принимает прежнюю таблицу трассировки за требование родителя при разбиении', () => {
    const parent = [
      '- [ ] **T17bab. Закрытие карточки клетки**.',
      '  Кнопка закрывает карточку.',
      '  *Приёмка:* DOM-тест и геометрия.',
      '',
    ].join('\n');
    const oldTrace = [
      '| Исходная строка T17ba | Подзадача |',
      '| --- | --- |',
      '| старая строка | T17bab |',
      '',
    ].join('\n');
    const children = [
      '- [ ] **T17baba. Кнопка закрытия**.',
      '  Кнопка закрывает карточку.',
      '  *Приёмка:* DOM-тест.',
      '',
      '- [ ] **T17babb. Геометрия**.',
      '  *Приёмка:* геометрия.',
      '',
      '| Исходная строка T17bab | Подзадача |',
      '| --- | --- |',
      '| Кнопка закрывает карточку | T17baba |',
      '| Приёмка DOM | T17baba |',
      '| Приёмка геометрия | T17babb |',
      '',
    ].join('\n');
    const next = '- [ ] **T17bb. Следующая задача**.\n';
    const withoutOwnTrace = children.split('| Исходная строка T17bab | Подзадача |')[0] ?? '';
    expect(
      verifySplit(
        '07/T17bab',
        { stageText: parent + oldTrace + next, status: 'Очередь: 07/T17bab → 07/T17bb' },
        {
          stageText: parent + withoutOwnTrace + oldTrace + next,
          status: 'Очередь: 07/T17baba → 07/T17babb → 07/T17bb',
        },
      ),
    ).toContain('нет отдельной таблицы трассировки T17bab; таблица предка не учитывается');
    expect(
      verifySplit(
        '07/T17bab',
        { stageText: parent + oldTrace + next, status: 'Очередь: 07/T17bab → 07/T17bb' },
        {
          stageText: parent + children + oldTrace + next,
          status: 'Очередь: 07/T17baba → 07/T17babb → 07/T17bb',
        },
      ),
    ).toEqual([]);
  });
  it('сохраняет родителя с прежней трассировкой при разнесении составного критерия', () => {
    const parent = [
      '- [ ] **T17bec. Цвет и контур** (`territory-labels.ts`, `test`).',
      '  Цвет — `players.palette[].line`, контур — `ui.surface`.',
      '  *Приёмка:* тесты проверяют цвет и контур; `pnpm verify --changed` проходит.',
      '',
      'Трассировка разбиения T17be:',
      '',
      '| Исходный текст | Подзадача |',
      '| --- | --- |',
      '| Цвет и контур | 07/T17bec |',
      '',
    ].join('\n');
    const children = [
      '- [ ] **T17beca. Цвет** (`territory-labels.ts`, `test`).',
      '  Цвет — `players.palette[].line`.',
      '  *Приёмка:* тесты проверяют цвет; `pnpm verify --changed` проходит.',
      '',
      '- [ ] **T17becb. Контур** (`territory-labels.ts`, `test`).',
      '  Контур — `ui.surface`.',
      '  *Приёмка:* тесты проверяют контур; `pnpm verify --changed` проходит.',
      '',
      'Трассировка разбиения T17bec:',
      '',
      '| Исходная строка T17bec | Подзадача |',
      '| --- | --- |',
      '| Описание: цвет | 07/T17beca |',
      '| Описание: контур | 07/T17becb |',
      '| Приёмка: цвет и контур | 07/T17beca и 07/T17becb |',
      '',
      'Трассировка разбиения T17be:',
      '',
      '| Исходный текст | Подзадача |',
      '| --- | --- |',
      '| Цвет и контур | 07/T17bec |',
      '',
    ].join('\n');
    const before = { stageText: parent, status: 'Очередь: 07/T17bec' };
    const after = {
      stageText: parent.split('Трассировка разбиения T17be:')[0] + children,
      status: 'Очередь: 07/T17beca → 07/T17becb',
    };
    expect(verifySplit('07/T17bec', before, after)).toEqual([]);
  });
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
    expect(run.codexArguments[0]).toContain('--output-schema');
    expect(run.codexArguments[0]?.join(' ')).toContain('plan.json');
    expect(run.codexArguments[1]).not.toContain('--output-schema');
    expect(run.codexArguments[2]?.join(' ')).toContain('review.json');
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

  it('сохраняет проверенное уточнение plan, если роль оставила только изменённый документ', async () => {
    const clarified = fixtureStage.replace(
      '  *Приёмка:* тесты.',
      '  *Приёмка:* тесты.\n  *Уточнение plan:* проверить детерминированную фикстуру.',
    );
    const run = await runWorld({
      plan: true,
      sessions: [
        {
          answer: 'PLAN: уточнено',
          stage: clarified,
          commit: false,
          dirty: ' M docs/stages/stage-06-bots-balance.md',
        },
        NEXT_DONE,
        REVIEW_OK,
      ],
    });
    expect(commands(run.prompts)).toEqual([`$plan ${TASK}`, `$task ${TASK}`, `$review ${TASK}`]);
    expect(run.lines).toContain(
      `$plan ${TASK}: проверенные документы сохранены коммитом оркестратора`,
    );
    expect(run.lines).toContain(`готово: ${TASK}`);
  });

  it('не сохраняет незакоммиченное уточнение, которое удалило исходную приёмку', async () => {
    const broken = fixtureStage.replace('  *Приёмка:* тесты.', '  *Приёмка:* другая проверка.');
    const run = await runWorld({
      plan: true,
      sessions: [
        {
          answer: 'PLAN: уточнено',
          stage: broken,
          commit: false,
          dirty: ' M docs/stages/stage-06-bots-balance.md',
        },
      ],
    });
    expect(run.prompts).toEqual([`$plan ${TASK}`]);
    expect(run.lines.some((line) => line.includes('сверка требований не пройдена'))).toBe(true);
    expect(run.lines.some((line) => line.includes('сохранены коммитом'))).toBe(false);
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

  it('возвращает неполное разбиение plan с точными ошибками и затем продолжает очередь', async () => {
    const parent = fixtureStage.replace(
      '  *Приёмка:* тесты.',
      '  *Приёмка:* тесты. Проверка геометрии.',
    );
    const first = parent.replace(
      '  *Приёмка:* тесты. Проверка геометрии.',
      '  *Приёмка:* тесты. Проверка геометрии.\n' +
        '- [ ] **T1j5-Б1a. Код** (tools/evolve).\n  *Приёмка:* проверка кода.\n' +
        '- [ ] **T1j5-Б1b. Геометрия** (tools/evolve).\n  *Приёмка:* проверка CSS.',
    );
    const repaired = first.replace(
      '- [ ] **T2. Итерации баланса**.',
      'Трассировка разбиения T1j5-Б1:\n\n' +
        '| Исходный текст | Подзадача |\n| --- | --- |\n' +
        '| Тесты | 06/T1j5-Б1a |\n| Геометрия | 06/T1j5-Б1b |\n\n' +
        '- [ ] **T2. Итерации баланса**.',
    );
    const status = fixtureStatus.replace('06/T1j5-Б1 →', '06/T1j5-Б1a → 06/T1j5-Б1b →');
    const run = await runWorld({
      stage: parent,
      plan: true,
      maxRounds: 1,
      sessions: [
        { answer: 'PLAN: разбито', stage: first, status, commit: true },
        { answer: 'PLAN: разбито', stage: repaired, commit: true },
        { task: 'T1j5-Б1a', mark: '~', answer: 'Готово.' },
        { task: 'T1j5-Б1a', mark: 'x', answer: 'OK' },
        { answer: 'PLAN: не трогал' },
        { answer: 'Готово.', commit: false },
      ],
    });
    expect(commands(run.prompts).slice(0, 3)).toEqual([
      `$plan ${TASK}`,
      `$plan ${TASK}`,
      '$task 06/T1j5-Б1a',
    ]);
    expect(run.prompts[1]).toContain('требование не перенесено в подзадачи');
    expect(run.lines).toContain(`$plan ${TASK}: разбито`);
  });

  it('принимает распределение путей и критериев родителя между подзадачами', () => {
    const parent = [
      '- [ ] **T9. Бой** (`sim/a.ts`, `client/b.ts`).',
      '  Первый механизм. Второй механизм.',
      '  *После:* T8.',
      '  *Приёмка:* Тест sim проверяет первый механизм. Тест клиента проверяет второй механизм.',
    ].join('\n');
    const beforeStage = `# Этап 07\n\n${parent}\n`;
    const afterStage = [
      '# Этап 07',
      '',
      parent,
      '- [ ] **T9a. Первый механизм** (`sim/a.ts`).',
      '  Первый механизм.',
      '  *Приёмка:* тест sim проверяет первый механизм.',
      '- [ ] **T9b. Второй механизм** (`client/b.ts`).',
      '  Второй механизм.',
      '  *Приёмка:* тест клиента проверяет второй механизм.',
    ].join('\n');
    const beforeStatus = 'Очередь: 07/T9 → 07/T10';
    const afterStatus = 'Очередь: 07/T9a → 07/T9b → 07/T10';

    expect(
      verifyPlanTransition(
        '07/T9',
        { stageText: beforeStage, status: beforeStatus },
        { stageText: afterStage, status: afterStatus },
        'разбито',
      ),
    ).toEqual([]);
  });

  it('принимает разложенную формулировку при полной трассировке и группе путей', () => {
    const parent = [
      '- [ ] **T9. Карточки** (`client/{unit.tsx,hex.tsx,card.css}`).',
      '  Кнопка закрывает карточки отряда и клетки.',
      '  *Приёмка:* тесты проверяют обе карточки.',
    ].join('\n');
    const beforeStage = `# Этап 07\n\n${parent}\n`;
    const afterStage = [
      '# Этап 07',
      '',
      parent,
      '- [ ] **T9a. Карточка отряда** (`client/{unit.tsx,card.css}`).',
      '  Кнопка закрывает карточку отряда.',
      '- [ ] **T9b. Карточка клетки** (`client/{hex.tsx,card.css}`).',
      '  Кнопка закрывает карточку клетки.',
      '',
      '| Исходная строка T9 | Подзадача |',
      '| --- | --- |',
      '| Закрытие карточки отряда | T9a |',
      '| Закрытие карточки клетки | T9b |',
      '| Тесты обеих карточек | T9b, зависит от T9a |',
    ].join('\n');
    expect(
      verifyPlanTransition(
        '07/T9',
        { stageText: beforeStage, status: 'Очередь: 07/T9 → 07/T10' },
        { stageText: afterStage, status: 'Очередь: 07/T9a → 07/T9b → 07/T10' },
        'разбито',
      ),
    ).toEqual([]);
  });

  it('plan удалил родителя при корректном разбиении — цикл восстанавливает его до работы', async () => {
    const original =
      '- [ ] **T1j5-Б1. Фитнес по метрикам самой особи** (tools/evolve).\n  *Приёмка:* тесты.';
    const splitWithoutParent = fixtureStage.replace(
      original,
      '- [ ] **T1j5-Б1a. Часть первая** (tools/evolve).\n  *Приёмка:* тесты.\n' +
        '- [ ] **T1j5-Б1b. Часть вторая** (tools/evolve).\n  *Проверка:* интеграция.',
    );
    const splitStatus = fixtureStatus.replace(
      'Очередь: 06/T1j5-Б1 → 06/T1i → 06/T1e',
      'Очередь: 06/T1j5-Б1a → 06/T1j5-Б1b → 06/T1i → 06/T1e',
    );
    const repaired = restoreMissingSplitParent(
      TASK,
      { stageText: fixtureStage, status: fixtureStatus },
      { stageText: splitWithoutParent, status: splitStatus },
    );
    expect(repaired).toContain(`${original}\n\n- [ ] **T1j5-Б1a.`);

    const run = await runWorld({
      plan: true,
      maxRounds: 1,
      sessions: [
        {
          answer: 'PLAN: разбито',
          stage: splitWithoutParent,
          status: splitStatus,
          commit: true,
          files: ['docs/stages/stage-06-bots-balance.md', 'docs/STATUS.md'],
        },
        { task: 'T1j5-Б1a', mark: '~', answer: 'Готово.' },
        { task: 'T1j5-Б1a', mark: 'x', answer: 'OK' },
        { answer: 'PLAN: не трогал' },
        { answer: 'Готово.', commit: false },
      ],
    });
    expect(run.lines).toContain(`$plan ${TASK}: восстановлен удалённый родитель разбиения`);
    expect(run.lines).toContain(`$plan ${TASK}: разбито`);
    expect(commands(run.prompts).slice(0, 2)).toEqual([`$plan ${TASK}`, '$task 06/T1j5-Б1a']);
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
    expect(run.lines).toContain(
      'жду: до 06/T1i очередь не дошла: 06/T1j5-Б1 ждут решений владельца в docs/QUESTIONS.md. Нажми Enter или B: варианты и свободный ввод',
    );
    expect(run.lines.some((line) => line.includes('очередь дошла до 06/T1i'))).toBe(false);
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
    expect(run.lines).toContain(
      'жду: до 06/T1i очередь не дошла: 06/T1j5-Б1 ждут решений владельца в docs/QUESTIONS.md. Нажми Enter или B: варианты и свободный ввод',
    );
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
    expect(run.lines).toContain(`жду: $plan ${TASK} не дал проверяемый исход — проверь`);
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
