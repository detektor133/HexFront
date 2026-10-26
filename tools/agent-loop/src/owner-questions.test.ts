import { describe, expect, it } from 'vitest';

import { customDecision, optionDecision, parsePlanQuestions } from './owner-questions.ts';

const QUESTIONS = `# Вопросы

2026-10-25 · 07/T17ay · Какая иконка цены · блокирует кнопки · предложение: использовать токены UI
2026-10-25 · 07/T17axb · Какая форма маркера · блокирует бой · предложение: описать шесть направлений
2026-10-19 · Раунд 6 · Старый вопрос · не блокирует · предложение: отложить
`;

describe('вопросы plan в консоли', () => {
  it('выбирает только вопросы перечисленных заблокированных задач', () => {
    expect(parsePlanQuestions(QUESTIONS, ['07/T17axb'])).toEqual([
      {
        task: '07/T17axb',
        question: 'Какая форма маркера',
        options: ['описать шесть направлений'],
        recommended: 0,
      },
    ]);
  });

  it('показывает вопросы в порядке очереди, а не в порядке строк QUESTIONS', () => {
    expect(
      parsePlanQuestions(QUESTIONS, ['07/T17axb', '07/T17ay']).map((question) => question.task),
    ).toEqual(['07/T17axb', '07/T17ay']);
  });

  it('формирует решение из конкретного варианта и принимает свободный ответ', () => {
    const [question] = parsePlanQuestions(QUESTIONS, ['07/T17ay']);
    expect(question).toBeDefined();
    if (question === undefined) throw new Error('вопрос T17ay не найден');
    expect(optionDecision(question, question.recommended)).toBe(
      '### 07/T17ay\n\nиспользовать токены UI',
    );
    expect(customDecision(question, '  две монеты 14×14  ')).toBe(
      '### 07/T17ay\n\nдве монеты 14×14',
    );
  });

  it('читает 2–3 варианта и номер рекомендации нового формата', () => {
    const text =
      '2026-10-26 · 07/T2 · Размер · блокирует · варианты: [1] 14 px | [2] 16 px | [3] 22 px · рекомендовано: 2 — соответствует сетке';
    expect(parsePlanQuestions(text, ['07/T2'])).toEqual([
      {
        task: '07/T2',
        question: 'Размер',
        options: ['14 px', '16 px', '22 px'],
        recommended: 1,
      },
    ]);
  });
});
