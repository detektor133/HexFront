/** Машинные исходы ролей; старые текстовые ответы читаются при восстановлении сессий. */
export type PlanOutcomeName =
  'не трогал' | 'уточнено' | 'разбито' | 'вопрос' | 'инфраструктура' | 'переделать';

const PLAN_OUTCOME_RE =
  /^`?PLAN:\s*(не трогал|уточнено|разбито|вопрос|инфраструктура|переделать)(?:\s*[—-]\s*(.+?))?`?\s*$/imu;
const PLAN_OUTCOMES: readonly string[] = [
  'не трогал',
  'уточнено',
  'разбито',
  'вопрос',
  'инфраструктура',
  'переделать',
];

export function parsePlanMessage(
  message: string,
): { readonly outcome: PlanOutcomeName; readonly detail: string } | undefined {
  if (message.trimStart().startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const result = parsed as { readonly outcome?: unknown; readonly detail?: unknown };
    if (!PLAN_OUTCOMES.includes(String(result.outcome)) || typeof result.detail !== 'string')
      return undefined;
    return { outcome: result.outcome as PlanOutcomeName, detail: result.detail.trim() };
  }
  const match = PLAN_OUTCOME_RE.exec(message);
  return match?.[1] === undefined
    ? undefined
    : { outcome: match[1] as PlanOutcomeName, detail: match[2]?.trim() ?? '' };
}
