/** Один открытый вопрос `plan` из docs/QUESTIONS.md. */
export interface PlanQuestion {
  readonly task: string;
  readonly question: string;
  readonly proposal: string;
}

/** Вопросы хранятся по одной строке: дата · задача · вопрос · блокировка · предложение. */
export function parsePlanQuestions(text: string, tasks: readonly string[]): PlanQuestion[] {
  const wanted = new Set(tasks);
  const order = new Map(tasks.map((task, index) => [task, index]));
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((line): PlanQuestion[] => {
      const parts = line.split(' · ');
      const task = parts[1];
      const proposal = parts[4]?.replace(/^предложение:\s*/u, '').trim();
      if (
        parts.length < 5 ||
        task === undefined ||
        !wanted.has(task) ||
        parts[2] === undefined ||
        proposal === undefined ||
        proposal === parts[4]
      )
        return [];
      return [{ task, question: parts[2].trim(), proposal }];
    })
    .sort((left, right) => (order.get(left.task) ?? 0) - (order.get(right.task) ?? 0));
}

/** Текст решения при выборе рекомендации: владелец делегирует недостающие UI-детали агенту. */
export const acceptProposal = (question: PlanQuestion): string =>
  `### ${question.task}\n\n${question.proposal}. ` +
  'Недостающие UI-параметры выбери самостоятельно из действующих токенов, зафиксируй в документах и не возвращай владельцу новым вопросом.';

/** Свободный ответ владельца с привязкой к задаче. */
export const customDecision = (question: PlanQuestion, answer: string): string =>
  `### ${question.task}\n\n${answer.trim()}`;
