// Зоны обзора обновляются раз в VISION_RECALC_TICKS тиков.
// GDD: docs/gdd/08-match.md — «Туман войны»
import { VISION_CITY, VISION_RECALC_TICKS, VISION_TERRITORY, VISION_UNIT } from '../balance.ts';
import { hexFromId, hexId, spiral, type HexId } from '../math/hex.ts';
import { intDiv } from '../math/int.ts';
import type { MatchState, VisionSource, VisionState } from '../state/types.ts';

export function createVisionState(players: number, size: number): VisionState {
  return {
    visible: Array.from({ length: players }, () => new Uint8Array(size)),
    explored: Array.from({ length: players }, () => new Uint8Array(size)),
    road: Array.from({ length: players }, () => new Uint8Array(size)),
    improvement: Array.from({ length: players }, () => new Uint8Array(size)),
    building: Array.from({ length: players }, () => new Uint8Array(size)),
    coverage: Array.from({ length: players }, () => new Uint16Array(size)),
    ownerByHex: new Int16Array(size).fill(-2),
    roadByHex: new Uint8Array(size),
    improvementByHex: new Uint8Array(size),
    buildingByHex: new Uint8Array(size),
    unitSources: new Map(),
    citySources: new Map(),
    dirty: Array.from({ length: players }, () => new Set<number>()),
    initialized: false,
  };
}

function forEachAround(
  state: MatchState,
  center: HexId,
  radius: number,
  callback: (id: number) => void,
): void {
  const origin = hexFromId(center, state.map.width);
  for (const hex of spiral(origin, radius)) {
    const row = hex.r + intDiv(hex.q + (hex.q & 1), 2);
    if (hex.q < 0 || hex.q >= state.map.width || row < 0 || row >= state.map.height) continue;
    callback(hexId(hex, state.map.width));
  }
}

function sourceRadius(source: 'territory' | 'unit' | 'city'): number {
  if (source === 'territory') return VISION_TERRITORY;
  return source === 'unit' ? VISION_UNIT : VISION_CITY;
}

function markDirty(vision: VisionState, player: number, id: number): void {
  vision.dirty[player]?.add(id);
}

function updateSource(
  state: MatchState,
  vision: VisionState,
  source: VisionSource,
  delta: 1 | -1,
  kind: 'territory' | 'unit' | 'city',
): void {
  if (source.owner < 0) return;
  const coverage = vision.coverage[source.owner];
  if (!coverage) return;
  forEachAround(state, source.hex, sourceRadius(kind), (id) => {
    coverage[id] = Math.max(0, (coverage[id] ?? 0) + delta);
    markDirty(vision, source.owner, id);
  });
}

function replaceSource(
  state: MatchState,
  vision: VisionState,
  previous: VisionSource | undefined,
  current: VisionSource,
  kind: 'unit' | 'city',
): void {
  if (previous && (previous.owner !== current.owner || previous.hex !== current.hex)) {
    updateSource(state, vision, previous, -1, kind);
  }
  if (!previous || previous.owner !== current.owner || previous.hex !== current.hex) {
    updateSource(state, vision, current, 1, kind);
  }
}

function flushDirty(state: MatchState, vision: VisionState): void {
  for (let player = 0; player < state.players.length; player += 1) {
    const dirty = vision.dirty[player];
    const visible = vision.visible[player];
    const explored = vision.explored[player];
    const roads = vision.road[player];
    const improvements = vision.improvement[player];
    const buildings = vision.building[player];
    if (!dirty || !visible || !explored || !roads || !improvements || !buildings) continue;
    for (const id of dirty) {
      const isVisible = vision.coverage[player]?.[id] !== 0;
      visible[id] = isVisible ? 1 : 0;
      if (!isVisible) continue;
      explored[id] = 1;
      roads[id] = state.hexes.road[id] ?? 0;
      improvements[id] = state.hexes.improvement[id] ?? 0;
      buildings[id] = state.hexes.building[id] ?? 0;
    }
    dirty.clear();
  }
}

function initializeIncremental(state: MatchState, vision: VisionState): void {
  for (let id = 0; id < state.hexes.owner.length; id += 1) {
    vision.ownerByHex[id] = state.hexes.owner[id] ?? -1;
    vision.roadByHex[id] = state.hexes.road[id] ?? 0;
    vision.improvementByHex[id] = state.hexes.improvement[id] ?? 0;
    vision.buildingByHex[id] = state.hexes.building[id] ?? 0;
    updateSource(state, vision, { owner: vision.ownerByHex[id] ?? -1, hex: id }, 1, 'territory');
  }
  for (const unit of state.units) {
    const source = { owner: unit.owner, hex: unit.hex };
    vision.unitSources.set(unit.id, source);
    updateSource(state, vision, source, 1, 'unit');
  }
  for (const city of state.cities) {
    const source = { owner: city.owner, hex: city.hex };
    vision.citySources.set(city.id, source);
    updateSource(state, vision, source, 1, 'city');
  }
  vision.initialized = true;
  flushDirty(state, vision);
}

function syncHexes(state: MatchState, vision: VisionState): void {
  for (let id = 0; id < state.hexes.owner.length; id += 1) {
    const owner = state.hexes.owner[id] ?? -1;
    if (vision.ownerByHex[id] !== owner) {
      updateSource(state, vision, { owner: vision.ownerByHex[id] ?? -1, hex: id }, -1, 'territory');
      updateSource(state, vision, { owner, hex: id }, 1, 'territory');
      vision.ownerByHex[id] = owner;
    }
    if (vision.roadByHex[id] !== state.hexes.road[id]) {
      vision.roadByHex[id] = state.hexes.road[id] ?? 0;
      for (let player = 0; player < state.players.length; player += 1)
        markDirty(vision, player, id);
    }
    if (vision.improvementByHex[id] !== state.hexes.improvement[id]) {
      vision.improvementByHex[id] = state.hexes.improvement[id] ?? 0;
      for (let player = 0; player < state.players.length; player += 1)
        markDirty(vision, player, id);
    }
    if (vision.buildingByHex[id] !== state.hexes.building[id]) {
      vision.buildingByHex[id] = state.hexes.building[id] ?? 0;
      for (let player = 0; player < state.players.length; player += 1)
        markDirty(vision, player, id);
    }
  }
}

function syncSources(state: MatchState, vision: VisionState, kind: 'unit' | 'city'): void {
  const sources = kind === 'unit' ? vision.unitSources : vision.citySources;
  const currentIds = new Set<number>();
  const entities = kind === 'unit' ? state.units : state.cities;
  for (const entity of entities) {
    const source = { owner: entity.owner, hex: entity.hex };
    currentIds.add(entity.id);
    replaceSource(state, vision, sources.get(entity.id), source, kind);
    sources.set(entity.id, source);
  }
  for (const [id, source] of sources) {
    if (currentIds.has(id)) continue;
    updateSource(state, vision, source, -1, kind);
    sources.delete(id);
  }
}

/** Полностью пересчитывает обзор для тестов эквивалентности и создания матча. */
export function recalculateVision(state: MatchState, vision: VisionState): void {
  for (let player = 0; player < state.players.length; player += 1) {
    const visible = vision.visible[player];
    const explored = vision.explored[player];
    if (!visible || !explored) continue;
    visible.fill(0);
    for (let id = 0; id < state.hexes.owner.length; id += 1) {
      if (state.hexes.owner[id] === player) {
        forEachAround(state, id, VISION_TERRITORY, (seenId) => {
          visible[seenId] = 1;
        });
      }
    }
    for (const unit of state.units) {
      if (unit.owner === player)
        forEachAround(state, unit.hex, VISION_UNIT, (id) => {
          visible[id] = 1;
        });
    }
    for (const city of state.cities) {
      if (city.owner === player)
        forEachAround(state, city.hex, VISION_CITY, (id) => {
          visible[id] = 1;
        });
    }
    for (let id = 0; id < state.hexes.owner.length; id += 1) {
      if (visible[id] !== 1) continue;
      explored[id] = 1;
      const roads = vision.road[player];
      const improvements = vision.improvement[player];
      const buildings = vision.building[player];
      if (roads) roads[id] = state.hexes.road[id] ?? 0;
      if (improvements) improvements[id] = state.hexes.improvement[id] ?? 0;
      if (buildings) buildings[id] = state.hexes.building[id] ?? 0;
    }
  }
}

/** Обновляет зоны обзора по изменениям источников, сохраняя периодичность правила игры. */
export function visionSystem(state: MatchState): void {
  state.vision ??= createVisionState(state.players.length, state.hexes.owner.length);
  if (!state.vision.initialized) {
    initializeIncremental(state, state.vision);
    return;
  }
  if (state.tick % VISION_RECALC_TICKS !== 0) return;
  syncHexes(state, state.vision);
  syncSources(state, state.vision, 'unit');
  syncSources(state, state.vision, 'city');
  flushDirty(state, state.vision);
}
