// Зоны обзора (раз в 10 тиков).
// GDD: docs/gdd/08-match.md — «Туман войны»
import { VISION_CITY, VISION_RECALC_TICKS, VISION_TERRITORY, VISION_UNIT } from '../balance.ts';
import { hexFromId, hexId, spiral, type HexId } from '../math/hex.ts';
import { intDiv } from '../math/int.ts';
import type { MatchState, VisionState } from '../state/types.ts';

export function createVisionState(players: number, size: number): VisionState {
  return {
    visible: Array.from({ length: players }, () => new Uint8Array(size)),
    explored: Array.from({ length: players }, () => new Uint8Array(size)),
    road: Array.from({ length: players }, () => new Uint8Array(size)),
    improvement: Array.from({ length: players }, () => new Uint8Array(size)),
    building: Array.from({ length: players }, () => new Uint8Array(size)),
  };
}

function markAround(state: MatchState, seen: Uint8Array, center: HexId, radius: number): void {
  const origin = hexFromId(center, state.map.width);
  for (const hex of spiral(origin, radius)) {
    const { q, r } = hex;
    const col = q;
    const row = r + intDiv(q + (q & 1), 2);
    if (col < 0 || col >= state.map.width || row < 0 || row >= state.map.height) continue;
    seen[hexId(hex, state.map.width)] = 1;
  }
}

function recalculate(state: MatchState, vision: VisionState): void {
  const size = state.hexes.owner.length;
  for (let playerId = 0; playerId < state.players.length; playerId += 1) {
    const visible = vision.visible[playerId];
    const explored = vision.explored[playerId];
    if (!visible || !explored) continue;
    visible.fill(0);
    for (let id = 0; id < size; id += 1) {
      if (state.hexes.owner[id] === playerId) markAround(state, visible, id, VISION_TERRITORY);
    }
    for (const unit of state.units) {
      if (unit.owner === playerId) markAround(state, visible, unit.hex, VISION_UNIT);
    }
    for (const city of state.cities) {
      if (city.owner === playerId) markAround(state, visible, city.hex, VISION_CITY);
    }
    for (let id = 0; id < size; id += 1) {
      if (visible[id] !== 1) continue;
      explored[id] = 1;
      const roads = vision.road[playerId];
      const improvements = vision.improvement[playerId];
      const buildings = vision.building[playerId];
      if (roads) roads[id] = state.hexes.road[id] ?? 0;
      if (improvements) improvements[id] = state.hexes.improvement[id] ?? 0;
      if (buildings) buildings[id] = state.hexes.building[id] ?? 0;
    }
  }
}

/** Пересчитывает зоны обзора и обновляет память виденных гексов. */
export function visionSystem(state: MatchState): void {
  if (state.tick % VISION_RECALC_TICKS !== 0 && state.vision) return;
  state.vision ??= createVisionState(state.players.length, state.hexes.owner.length);
  recalculate(state, state.vision);
}
