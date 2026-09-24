// Доход игроков: налог с населения, города, шахты.
// GDD: docs/gdd/02-economy.md — «Золото»
import { CITY_GOLD_PER_LEVEL, GOLD_PER_POP_TAX, MINE_GOLD_PER_S, TICKS_PER_S } from '../balance.ts';
import { FEATURE } from '../map/types.ts';
import { fpMul, intDiv, type Fp } from '../math/int.ts';
import { NEUTRAL, type MatchState } from '../state/types.ts';

interface Base {
  pop: number;
  mines: number;
  cityLevels: number;
}

function incomeBases(state: MatchState): Base[] {
  const bases = state.players.map(() => ({ pop: 0, mines: 0, cityLevels: 0 }));
  const { owner, pop } = state.hexes;
  for (let id = 0; id < owner.length; id += 1) {
    const base = bases[owner[id] ?? NEUTRAL];
    if (!base) continue;
    base.pop += pop[id] ?? 0;
    if (state.map.features[id] === FEATURE.mine) base.mines += 1;
  }
  for (const c of state.cities) {
    const base = bases[c.owner];
    if (base) base.cityLevels += c.level;
  }
  return bases;
}

/**
 * Начисляет доход за тик:
 * income/с = Σpop × taxEffective × GOLD_PER_POP_TAX + Σ CITY_GOLD_PER_LEVEL × level + Σ MINE_GOLD_PER_S.
 * Расходы (содержание армий) и банкротство — этап 03.
 */
export function economySystem(state: MatchState): void {
  const bases = incomeBases(state);
  state.players.forEach((p, i) => {
    const base = bases[i];
    if (p.status !== 'alive' || !base) return;
    // TODO(stage-02/T7): ×ISOLATED_INCOME_MULT для гексов и городов изолированных сетей.
    const perSecond =
      fpMul(fpMul(base.pop as Fp, p.taxEffective), GOLD_PER_POP_TAX) +
      CITY_GOLD_PER_LEVEL * base.cityLevels +
      MINE_GOLD_PER_S * base.mines;
    p.gold = (p.gold + intDiv(perSecond, TICKS_PER_S)) as Fp;
  });
}
