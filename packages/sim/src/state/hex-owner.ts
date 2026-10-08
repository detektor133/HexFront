// Единственное место смены владельца гекса: захват, выбывание, старт матча и тестовый DSL идут
// через setHexOwner, чтобы фронты рядом переносились сразу (04/T13), а потерянные гексы у фронта
// запоминались для commander (CR-006).
// GDD: docs/gdd/07-controls.md — «Линия фронта», «Автокомандование».
import { markNetworkDirty } from './derived-cache.ts';
import { edgeHex } from './edges.ts';
import { followFrontsNear } from './front.ts';
import type { MatchState } from './types.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';

const ownerOf = (state: MatchState, armyId: number): number =>
  state.armies.find((a) => a.id === armyId)?.owner ?? -1;

// Свой гекс фронта взят — фронт его помнит (до переноса: после гекс уже не свой).
function markLost(state: MatchState, hex: HexId, was: number): void {
  state.plans.forEach((plan, i) => {
    if (plan.kind !== 'front' || ownerOf(state, plan.armyId) !== was) return;
    if (!plan.edges.some((e) => edgeHex(e) === hex)) return;
    const lost = [...new Set([...(plan.lost ?? []), hex])].sort((a, b) => a - b);
    state.plans[i] = { ...plan, lost };
  });
}

// Отбитые и ушедшие от фронта гексы выбывают из списка потерянных.
function pruneLost(state: MatchState): void {
  const { width } = state.map;
  state.plans.forEach((plan, i) => {
    if (plan.kind !== 'front' || !plan.lost || plan.lost.length === 0) return;
    const owner = ownerOf(state, plan.armyId);
    const front = plan.edges.map((e) => hexFromId(edgeHex(e), width));
    const lost = plan.lost.filter(
      (h) =>
        state.hexes.owner[h] !== owner && front.some((f) => distance(f, hexFromId(h, width)) <= 1),
    );
    if (lost.length !== plan.lost.length) state.plans[i] = { ...plan, lost };
  });
}

/** Меняет владельца гекса (id игрока или NEUTRAL) и переносит фронты у этого гекса. */
export function setHexOwner(state: MatchState, hex: HexId, owner: number): void {
  const was = state.hexes.owner[hex] ?? -1;
  if (was === owner) return;
  if (was >= 0) markLost(state, hex, was);
  state.hexes.owner[hex] = owner;
  state.supplyRevision += 1;
  markNetworkDirty(state, was);
  markNetworkDirty(state, owner);
  followFrontsNear(state, hex);
  pruneLost(state);
}
