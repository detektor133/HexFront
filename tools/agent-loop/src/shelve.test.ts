import { describe, expect, it } from 'vitest';

import { issue, runWorld, type Session } from './test-world.ts';

const QUESTION: Session[] = [
  { answer: 'verify красный', dirty: true },
  { answer: 'Блокер: старый тест требует сид 42, задача — случайный сид', dirty: true },
];
const DONE: Session = { task: 'T1j5-Б1', mark: '~', answer: 'Готово' };
const REVIEW_OK: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'OK' };

describe('вопрос исполнителя при недоделанной работе', () => {
  it('ожидание называет вопрос и ответ — Issue «$decide»', async () => {
    const run = await runWorld({ sessions: QUESTION });
    expect(run.lines).toContain(
      'жду: 06/T1j5-Б1 ждёт твоего ответа: «Блокер: старый тест требует сид 42, задача — случайный сид». Ответ — Issue «$decide» с решением; работа задачи останется и продолжится сама',
    );
  });

  it('ответ $decide исполняется, работа откладывается и возвращается, задача продолжается с ответом', async () => {
    // 2026-10-14, 07/T3: при грязном дереве цикл исполнял только $done, и ответ владельца на
    // вопрос исполнителя не мог исполниться никогда.
    const run = await runWorld({
      sessions: [...QUESTION, { answer: 'записано решение', commit: true }, DONE, REVIEW_OK],
      polls: 2,
      arrival: issue(12, '$decide 06/T1j5-Б1: старый тест заменить'),
    });
    expect(run.prompts[2]).toBe('$decide 06/T1j5-Б1: старый тест заменить');
    expect(run.stashes).toEqual(['push', 'pop']);
    expect(run.prompts[3]).toMatch(
      /^\$task 06\/T1j5-Б1 продолжить\nПока работа ждала, владелец ответил Issue #12 \(\$decide 06\/T1j5-Б1: старый тест заменить\)/u,
    );
    expect(run.prompts[4]).toBe('$review 06/T1j5-Б1');
    expect(run.closed).toContain(12);
    // Коммит ответа ждёт только `ci.yml`: workflow, сломанный задачей, не держит запись решения.
    expect(run.ciArgs[0]).toBe('');
  });

  it('перезапуск цикла не спрашивает снова: ждёт ответа на тот же вопрос', async () => {
    const reason = '06/T1j5-Б1 ждёт твоего ответа: «вопрос». Ответ — Issue «$decide»';
    const run = await runWorld({
      dirty: true,
      sessions: [],
      state: { waitingAnswer: { task: '06/T1j5-Б1', reason } },
    });
    expect(run.prompts).toEqual([]);
    expect(run.lines).toContain(`жду: ${reason}`);
  });

  it('Issue, не связанная с ответом ($task), при недоделанной работе ждёт', async () => {
    const run = await runWorld({
      dirty: true,
      sessions: [],
      state: { waitingAnswer: { task: '06/T1j5-Б1', reason: 'вопрос' } },
      issues: [issue(13, '$task 06/T1e')],
    });
    expect(run.prompts).toEqual([]);
    expect(run.stashes).toEqual([]);
  });
});
