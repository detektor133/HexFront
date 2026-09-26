// Планы своих армий в снимке игрока (CR-002…CR-004): грани фронта (уже перенесённые на текущую
// границу), линия наступления, гексы линии обороны.
// GDD: docs/gdd/07-controls.md — «Планы армий».
import type { HexId } from '../math/hex.ts';
import { edgeHexes } from '../state/edges.ts';
import { frontEdgesNow, planHexes } from '../state/front.ts';
import { offensiveZone } from '../state/offensive-zone.ts';
import type { MatchState, OffensiveLine } from '../state/types.ts';

/** План армии для отрисовки. */
export type PlanView =
  | {
      readonly armyId: number;
      readonly kind: 'front';
      /** Грани фронта на текущей границе (EdgeId), по порядку. */
      readonly edges: readonly number[];
      /** Гексы участка фронта. */
      readonly hexes: readonly HexId[];
      readonly offensive: OffensiveLine | null;
      /** Гексы зоны наступления по возрастанию HexId (для прогноза); пусто без наступления. */
      readonly zone: readonly HexId[];
    }
  | { readonly armyId: number; readonly kind: 'line'; readonly hexes: readonly HexId[] };

/** Планы армий игрока playerId; чужие планы не видны. */
export function planViews(state: MatchState, playerId: number): PlanView[] {
  const mine = new Set(state.armies.filter((a) => a.owner === playerId).map((a) => a.id));
  return state.plans
    .filter((p) => mine.has(p.armyId))
    .map((p): PlanView => {
      if (p.kind === 'line') return { armyId: p.armyId, kind: 'line', hexes: planHexes(state, p) };
      const edges = frontEdgesNow(state, p);
      const hexes = edgeHexes(edges);
      const zone = p.offensive
        ? [...offensiveZone(state, playerId, hexes, p.offensive.hexes).keys()]
        : [];
      return {
        armyId: p.armyId,
        kind: 'front',
        edges,
        hexes,
        offensive: p.offensive,
        zone: zone.sort((a, b) => a - b),
      };
    });
}
