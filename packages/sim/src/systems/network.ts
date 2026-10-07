// Сети снабжения и изоляция городов; пересчёт размазан по игрокам.
// GDD: docs/gdd/04-roads-supply.md — «Сети снабжения»; sim-core.md — «Производительность».
import { NETWORK_RECALC_TICKS } from '../balance.ts';
import { networkNeedsRecompute } from '../state/derived-cache.ts';
import { recomputeNetworks } from '../state/network.ts';
import { invalidatePopulationRatesForPlayer } from '../state/population.ts';
import type { MatchState } from '../state/types.ts';

/** Раз в NETWORK_RECALC_TICKS пересчитывает сети игрока i в тике tick % 10 == i % 10. */
export function networkSystem(state: MatchState): void {
  const phase = state.tick % NETWORK_RECALC_TICKS;
  for (const p of state.players) {
    if (p.status !== 'alive' || p.id % NETWORK_RECALC_TICKS !== phase) continue;
    if (networkNeedsRecompute(state, p.id)) {
      recomputeNetworks(state, p.id);
      invalidatePopulationRatesForPlayer(state, p.id);
    }
  }
}
