import { describe, expect, it } from 'vitest';

import { issue, runWorld, type Session } from './test-world.ts';

const QUESTION: Session[] = [
  { answer: 'verify красный', dirty: true },
  { answer: 'Блокер: старый тест требует сид 42, задача — случайный сид', dirty: true },
];
const REVIEW_OK: Session = { answer: 'OK' };

describe('незакоммиченная работа и ответы владельца', () => {
  it('красный тест продолжает исполнитель, а не Issue владельца', async () => {
    const run = await runWorld({
      sessions: [
        ...QUESTION,
        { answer: 'ВОЗВРАТ\n- ТЕСТ: неверная фикстура' },
        { answer: 'Исправлено.', commit: true },
        REVIEW_OK,
        REVIEW_OK,
      ],
      verify: ['verify: FAIL tests', 'verify: FAIL tests'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });
    expect(run.prompts.slice(0, 4).map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
    ]);
    expect(run.lines.join('\n')).not.toContain('Ответ — Issue «$decide»');
  });

  it('явный ответ владельца на старый вопрос по-прежнему исполняется с сохранением дерева', async () => {
    const reason = '06/T1j5-Б1 ждёт твоего ответа: «вопрос». Ответ — Issue «$decide»';
    const run = await runWorld({
      dirty: true,
      state: { waitingAnswer: { task: '06/T1j5-Б1', reason } },
      sessions: [{ answer: 'записано решение', commit: true }],
      polls: 2,
      arrival: issue(12, '$decide 06/T1j5-Б1: старый тест заменить'),
    });
    expect(run.prompts[0]).toBe('$decide 06/T1j5-Б1: старый тест заменить');
    expect(run.stashes).toEqual(['push', 'pop']);
    expect(run.closed).toContain(12);
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
