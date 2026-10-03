// Планы своих армий в снимке игрока (CR-002…CR-004): грани фронта как есть в плане (план сам едет
// за границей при каждой смене владельца гекса), линия наступления, гексы линии обороны.
// GDD: docs/gdd/07-controls.md — «Планы армий».
import { OFFENSIVE_STUCK_TICKS } from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import { edgeHexes } from '../state/edges.ts';
import { planHexes } from '../state/front.ts';
import { facingEdges, lineDistance, offensiveTargets } from '../state/offensive-steps.ts';
import type { MatchState, OffensiveLine } from '../state/types.ts';

/** План армии для отрисовки. */
export type PlanView =
  | {
      readonly armyId: number;
      readonly kind: 'front';
      /** Грани фронта из плана (EdgeId), по порядку. */
      readonly edges: readonly number[];
      /** Гексы участка фронта. */
      readonly hexes: readonly HexId[];
      readonly offensive: OffensiveLine | null;
      /**
       * Гексы, куда могут шагнуть наступающие отряды, по возрастанию HexId (для прогноза у
       * линии); пусто без линии наступления.
       */
      readonly zone: readonly HexId[];
      /** Идущее наступление дольше OFFENSIVE_STUCK_TICKS без продвижения — «упёрлись». */
      readonly stuck: boolean;
      /** Грани фронта, смотрящие на линию наступления, в порядке фронта (хвосты стрелок). */
      readonly facing: readonly number[];
      /** Свои гексы у фронта, взятые врагом (отбивает commander, CR-006). */
      readonly lost: readonly HexId[];
      /** Нажата ▶ у армии с auto без линии — линию строит commander (CR-006). */
      readonly startWanted: boolean;
    }
  | { readonly armyId: number; readonly kind: 'line'; readonly hexes: readonly HexId[] };

/** Планы армий игрока playerId; чужие планы не видны. */
export function planViews(state: MatchState, playerId: number): PlanView[] {
  const mine = new Set(state.armies.filter((a) => a.owner === playerId).map((a) => a.id));
  return state.plans
    .filter((p) => mine.has(p.armyId))
    .map((p): PlanView => {
      if (p.kind === 'line') return { armyId: p.armyId, kind: 'line', hexes: planHexes(state, p) };
      const { edges } = p;
      const hexes = edgeHexes(edges);
      const zone = p.offensive ? offensiveTargets(state, playerId, edges, p.offensive.hexes) : [];
      const facing = p.offensive
        ? facingEdges(state, edges, lineDistance(state, p.offensive.hexes))
        : [];
      const stuck =
        p.offensive?.active === true &&
        state.tick - p.offensive.progressTick > OFFENSIVE_STUCK_TICKS;
      return {
        armyId: p.armyId,
        kind: 'front',
        edges,
        hexes,
        offensive: p.offensive,
        zone,
        stuck,
        facing,
        lost: [...(p.lost ?? [])],
        startWanted: p.startWanted === true,
      };
    });
}
