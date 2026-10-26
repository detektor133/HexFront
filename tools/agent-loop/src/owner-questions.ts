/** Один открытый вопрос `plan` из docs/QUESTIONS.md. */
export interface PlanQuestion {
  readonly task: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly recommended: number;
}

/** Вопросы хранятся по одной строке; старое поле «предложение» читается как один вариант. */
export function parsePlanQuestions(text: string, tasks: readonly string[]): PlanQuestion[] {
  const wanted = new Set(tasks);
  const order = new Map(tasks.map((task, index) => [task, index]));
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((line): PlanQuestion[] => {
      const parts = line.split(' · ');
      const task = parts[1];
      const choices = parts[4];
      if (
        parts.length < 5 ||
        task === undefined ||
        !wanted.has(task) ||
        parts[2] === undefined ||
        choices === undefined
      )
        return [];
      const options = choices.startsWith('варианты:')
        ? choices
            .replace(/^варианты:\s*/u, '')
            .split(/\s+\|\s+/u)
            .map((option) => option.replace(/^\[\d+\]\s*/u, '').trim())
            .filter(Boolean)
        : [choices.replace(/^предложение:\s*/u, '').trim()];
      const requested = Number(/^рекомендовано:\s*(\d+)/u.exec(parts[5] ?? '')?.[1] ?? 1) - 1;
      return [
        {
          task,
          question: parts[2].trim(),
          options,
          recommended: Math.min(Math.max(requested, 0), Math.max(options.length - 1, 0)),
        },
      ];
    })
    .sort((left, right) => (order.get(left.task) ?? 0) - (order.get(right.task) ?? 0));
}

/** Текст решения при выборе конкретного предложенного варианта. */
export const optionDecision = (question: PlanQuestion, index: number): string =>
  `### ${question.task}\n\n${question.options[index] ?? question.options[question.recommended] ?? ''}`;

/** Свободный ответ владельца с привязкой к задаче. */
export const customDecision = (question: PlanQuestion, answer: string): string =>
  `### ${question.task}\n\n${answer.trim()}`;
