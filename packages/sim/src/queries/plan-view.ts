// Планы своих армий в снимке игрока (CR-002): гексы линий и зона наступления для отрисовки.
// GDD: docs/gdd/07-controls.md — «Планы армий».
import type { HexId } from '../math/hex.ts';
import { planHexes } from '../state/front.ts';
import { offensiveZone } from '../state/offensive-zone.ts';
import type { MatchState } from '../state/types.ts';

/** План армии: текущие гексы фронта или линии обороны, линия и зона наступления. */
export type PlanView =
  | {
      readonly armyId: number;
      readonly kind: 'front';
      /** Текущие гексы участка фронта на своей границе. */
      readonly hexes: readonly HexId[];
      readonly offensive: readonly HexId[] | null;
      /** Гексы зоны наступления по возрастанию HexId; пусто без наступления. */
      readonly zone: readonly HexId[];
    }
  | { readonly armyId: number; readonly kind: 'line'; readonly hexes: readonly HexId[] };

/** Планы армий игрока playerId; чужие планы не видны. */
export function planViews(state: MatchState, playerId: number): PlanView[] {
  const mine = new Set(state.armies.filter((a) => a.owner === playerId).map((a) => a.id));
  return state.plans
    .filter((p) => mine.has(p.armyId))
    .map((p): PlanView => {
      const hexes = planHexes(state, p);
      if (p.kind === 'line') return { armyId: p.armyId, kind: 'line', hexes };
      const zone = p.offensive
        ? [...offensiveZone(state, playerId, hexes, p.offensive).keys()]
        : [];
      return {
        armyId: p.armyId,
        kind: 'front',
        hexes,
        offensive: p.offensive,
        zone: zone.sort((a, b) => a - b),
      };
    });
}
