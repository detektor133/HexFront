// Снабжённость отрядов и таймеры истощения; пересчёт размазан по игрокам.
// GDD: docs/gdd/04-roads-supply.md — «Снабжение отрядов», «Последствия снабжения».
import { ATTRITION_THRESHOLD, NETWORK_RECALC_TICKS } from '../balance.ts';
import { recomputeSupply } from '../state/supply.ts';
import type { MatchState } from '../state/types.ts';

/**
 * Раз в NETWORK_RECALC_TICKS пересчитывает снабжённость отрядов игрока i в тике
 * tick % 10 == i % 10; каждый тик ведёт таймер «снабжение ниже порога».
 */
export function supplySystem(state: MatchState): void {
  const phase = state.tick % NETWORK_RECALC_TICKS;
  for (const p of state.players) {
    if (p.status === 'alive' && p.id % NETWORK_RECALC_TICKS === phase) recomputeSupply(state, p.id);
  }
  for (const u of state.units) {
    u.lowSupplyTicks = u.supplyLevel < ATTRITION_THRESHOLD ? u.lowSupplyTicks + 1 : 0;
  }
}
