import { describe, expect, it } from 'vitest';

import { lastReturnItems, skippedPrompt, touchedPaths, untouchedItems } from './return-guard.ts';
import { fixtureStage, runWorld, setMark, type Session } from './test-world.ts';

const MENU = 'apps/client/src/MainMenu.tsx';

describe('пункты последнего возврата', () => {
  it('берёт пункты последнего блока «Возврат ревью:», прежние блоки не считает', () => {
    const block = [
      '- [ ] **T13. Меню**',
      '  Возврат ревью:',
      '  - старый.ts:1 — прошлый круг',
      '  Возврат ревью:',
      `  - ${MENU}:40 — фон не из снимков`,
      '  * СПЕК: x.test.ts:3 — нет проверки',
      ' *Приёмка:* тест.',
    ].join('\n');
    expect(lastReturnItems(block)).toEqual([
      `${MENU}:40 — фон не из снимков`,
      'СПЕК: x.test.ts:3 — нет проверки',
    ]);
    expect(lastReturnItems('- [ ] **T1. Без возврата**')).toEqual([]);
  });

  it('пути diff: при переименовании и старый, и новый', () => {
    expect(touchedPaths(`M\ta.ts\nR090\told.ts\tnew.ts\nD\tgone.ts\n`)).toEqual([
      'a.ts',
      'old.ts',
      'new.ts',
      'gone.ts',
    ]);
    expect(touchedPaths('')).toEqual([]);
  });
});

describe('пропуск пунктов возврата', () => {
  const item = `${MENU}:40 — фон не из снимков`;

  it('файл пункта не менялся — пункт пропущен; изменился (в том числе по имени) — нет', () => {
    expect(untouchedItems([item], ['docs/stages/s.md'])).toEqual([item]);
    expect(untouchedItems([item], [MENU])).toEqual([]);
    expect(untouchedItems(['MainMenu.tsx:40 — фон'], [MENU])).toEqual([]);
  });

  it('одного изменённого файла из нескольких в пункте достаточно', () => {
    expect(untouchedItems([`${MENU}:1 и worker.ts:2 — связь`], ['src/worker.ts'])).toEqual([]);
  });

  it('пункты без ссылок и СПЕК пропуском не считаются; закрытый тест задачи — тоже', () => {
    const locked = 'apps/client/test/locked.test.ts';
    const items = [
      'нет проверки клика',
      `СПЕК: ${MENU}:40 — тест слаб`,
      `${locked}:12 — пункт о закрытом тесте`,
    ];
    expect(untouchedItems(items, [], [locked])).toEqual([]);
  });

  it('обычный, не закрытый тест-файл судится как любой другой файл', () => {
    // 2026-10-17, 07/T22: возврат указал на view-delta-memory.test.ts, исполнитель вместо него
    // правил код цикла — прежнее исключение всех *.test.* файлов этот пропуск не ловило.
    const item = 'apps/client/test/view-delta-memory.test.ts:23-46,117 — слабее toEqual';
    expect(untouchedItems([item], [], ['apps/client/test/locked.test.ts'])).toEqual([item]);
    expect(untouchedItems([item], ['apps/client/test/view-delta-memory.test.ts'], [])).toEqual([]);
  });

  it('запрос повтора называет пункты и оставляет выход, если пункт выполнен в другом файле', () => {
    const prompt = skippedPrompt('07/T13', [item]);
    expect(prompt.split('\n')[0]).toBe('$task 07/T13 пункты возврата ревью не выполнены');
    expect(prompt).toContain(`- ${item}`);
    expect(prompt).toContain('в другом файле');
  });
});

const TASK = '06/T1j5-Б1';
const RETURNED = setMark(fixtureStage, 'T1j5-Б1', ' ').replace(
  '  *Приёмка:* тесты.',
  `  Возврат ревью:\n  - ${MENU}:40 — фон не из снимков\n  *Приёмка:* тесты.`,
);
const WORK: Session = { task: 'T1j5-Б1', mark: '~', answer: 'Готово.' };
const BACK: Session = { stage: RETURNED, answer: `ВОЗВРАТ\n- ${MENU}:40 — фон не из снимков` };
const OK: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'OK\nвсё подтверждено' };

describe('сторож в цикле', () => {
  it('файл пункта не тронут: один явный повтор работы, затем ожидание с причиной', async () => {
    const run = await runWorld({
      reviewDiff: '',
      reviewFiles: 'M\tdocs/stages/stage-06-bots-balance.md',
      sessions: [WORK, BACK, WORK, WORK],
    });
    expect(run.prompts).toHaveLength(4);
    expect(run.prompts[3]).toContain('пункты возврата ревью не выполнены');
    expect(run.prompts[3]).toContain(`${MENU}:40`);
    expect(run.lines.join('\n')).toContain(
      `исполнитель не тронул файлы пунктов возврата ${TASK} даже после напоминания`,
    );
    expect(run.lines).not.toContain(`готово: ${TASK}`);
  });

  it('файл пункта изменён — сторож молчит, задача идёт на ревью', async () => {
    const run = await runWorld({
      reviewDiff: '',
      reviewFiles: `M\t${MENU}\nM\tdocs/stages/stage-06-bots-balance.md`,
      sessions: [WORK, BACK, WORK, OK],
    });
    expect(run.prompts.join('\n')).not.toContain('пункты возврата ревью не выполнены');
    expect(run.lines).toContain(`готово: ${TASK}`);
  });

  it('первый круг и ответ без данных о diff сторож не включают', async () => {
    const first = await runWorld({ reviewDiff: '', sessions: [WORK, OK] });
    expect(first.prompts.join('\n')).not.toContain('пункты возврата ревью не выполнены');
    const noData = await runWorld({ reviewDiff: '', sessions: [WORK, BACK, WORK, OK] });
    expect(noData.lines).toContain(`готово: ${TASK}`);
  });
});
