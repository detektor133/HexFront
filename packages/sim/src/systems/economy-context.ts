import { incomeBases, type IncomeBase } from './economy.ts';
import { growthPerSecond } from './population.ts';
import type { MatchState } from '../state/types.ts';

export interface EconomyContext {
  readonly growth: Int32Array;
  readonly incomeBases: readonly IncomeBase[];
}

/**
 * Строит общие расчёты экономики для одного состояния матча.
 * @returns рост людей в секунду и базы дохода
 */
export function createEconomyContext(state: MatchState): EconomyContext {
  return {
    growth: growthPerSecond(state),
    incomeBases: incomeBases(state),
  };
}
