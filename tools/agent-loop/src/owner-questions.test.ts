import { describe, expect, it } from 'vitest';

import { acceptProposal, customDecision, parsePlanQuestions } from './owner-questions.ts';

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
        proposal: 'описать шесть направлений',
      },
    ]);
  });

  it('показывает вопросы в порядке очереди, а не в порядке строк QUESTIONS', () => {
    expect(
      parsePlanQuestions(QUESTIONS, ['07/T17axb', '07/T17ay']).map((question) => question.task),
    ).toEqual(['07/T17axb', '07/T17ay']);
  });

  it('рекомендация разрешает агенту определить недостающие UI-параметры без нового вопроса', () => {
    const [question] = parsePlanQuestions(QUESTIONS, ['07/T17ay']);
    expect(question).toBeDefined();
    if (question === undefined) throw new Error('вопрос T17ay не найден');
    expect(acceptProposal(question)).toContain('не возвращай владельцу новым вопросом');
    expect(customDecision(question, '  две монеты 14×14  ')).toBe(
      '### 07/T17ay\n\nдве монеты 14×14',
    );
  });
});
