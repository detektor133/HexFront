// Налог: сдвиг taxEffective к taxTarget и множитель роста населения от налога.
// GDD: docs/gdd/02-economy.md — «Налог»
import {
  TAX_GROWTH_AT_0,
  TAX_GROWTH_AT_20,
  TAX_GROWTH_AT_40,
  TAX_MAX,
  TAX_SLEW_PER_S,
  TICKS_PER_S,
} from '../balance.ts';
import { fp, intDiv, type Fp } from '../math/int.ts';
import type { MatchState } from '../state/types.ts';

// Средняя точка таблицы TAX_GROWTH_AT_0/_20/_40 — налог 20 %.
const TAX_GROWTH_KNOT = fp(0.2);
const SLEW_PER_TICK = intDiv(TAX_SLEW_PER_S, TICKS_PER_S);

/**
 * Множитель роста населения от налога:
 * taxGrowthMult(t) = t ≤ 20 ? 1,4 − 0,02 × t : 1,0 − 0,025 × (t − 20), t — в процентах.
 * Реализован как кусочно-линейная интерполяция по TAX_GROWTH_AT_0/_20/_40.
 * @param tax доля налога в fixed-point (200 = 20 %)
 * @returns множитель в fixed-point (1000 = ×1,0)
 */
export function taxGrowthMult(tax: Fp): Fp {
  if (tax <= TAX_GROWTH_KNOT) {
    return (TAX_GROWTH_AT_0 +
      intDiv((TAX_GROWTH_AT_20 - TAX_GROWTH_AT_0) * tax, TAX_GROWTH_KNOT)) as Fp;
  }
  const span = TAX_MAX - TAX_GROWTH_KNOT;
  return (TAX_GROWTH_AT_20 +
    intDiv((TAX_GROWTH_AT_40 - TAX_GROWTH_AT_20) * (tax - TAX_GROWTH_KNOT), span)) as Fp;
}

/** Сдвигает фактический налог к выбранному не быстрее TAX_SLEW_PER_S. */
export function taxSystem(state: MatchState): void {
  for (const p of state.players) {
    if (p.status !== 'alive' || p.taxEffective === p.taxTarget) continue;
    const diff = p.taxTarget - p.taxEffective;
    const stepFp = diff > 0 ? Math.min(diff, SLEW_PER_TICK) : Math.max(diff, -SLEW_PER_TICK);
    p.taxEffective = (p.taxEffective + stepFp) as Fp;
  }
}
