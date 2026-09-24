// Создание матча из карты по правилам старта. GDD: docs/gdd/08-match.md — «Старт».
import {
  NEUTRAL_HEX_POP_RATIO,
  ORG_MAX,
  START_ARMIES,
  START_ARMY_SOLDIERS,
  START_ARMY_TYPE,
  START_GOLD,
  START_HEXES,
  START_POP_CAPITAL,
  START_POP_HEX,
  TAX_DEFAULT,
} from '../balance.ts';
import { recomputeAllNetworks } from './network.ts';
import { cityPopCap, hexPopCap } from './pop-cap.ts';
import { fork, RNG_STREAM, shuffle } from '../rng.ts';
import { NEUTRAL, type City, type MatchState } from './types.ts';
import { TERRAIN, type MapStatic } from '../map/types.ts';
import { hexId, inBounds, neighbors, type Hex, type HexId } from '../math/hex.ts';
import { FP, fpMul, type Fp } from '../math/int.ts';

/** Участник матча; id игрока — индекс в массиве. */
export interface PlayerSetup {
  readonly name: string;
}

function emptyState(map: MapStatic, seed: number): MatchState {
  const size = map.width * map.height;
  const cities: City[] = map.cities.map((c) => ({
    id: c.id,
    hex: hexId(c, map.width),
    owner: NEUTRAL,
    level: c.level,
    name: c.name,
    garrison: (c.garrison * FP) as Fp,
  }));
  return {
    tick: 0,
    seed: seed >>> 0,
    map,
    hexes: {
      owner: new Int16Array(size).fill(NEUTRAL),
      pop: new Int32Array(size),
      improvement: new Uint8Array(size),
      building: new Uint8Array(size),
      road: Uint8Array.from(map.roads),
      network: new Int32Array(size).fill(-1),
    },
    cities,
    players: [],
    armies: [],
    constructions: [],
    networks: [],
    nextId: cities.reduce((max, c) => Math.max(max, c.id), 0) + 1,
    events: [],
  };
}

/**
 * Заполняет население по правилу старта для нейтральной земли: NEUTRAL_HEX_POP_RATIO лимита,
 * чтобы захват сразу давал налог. Стартовые гексы игроков потом перезаписываются.
 */
export function seedNeutralPopulation(state: MatchState): void {
  const { pop } = state.hexes;
  for (let id = 0; id < pop.length; id += 1) {
    pop[id] = fpMul(hexPopCap(state, id), NEUTRAL_HEX_POP_RATIO);
  }
  for (const c of state.cities) pop[c.hex] = fpMul(cityPopCap(c.level), NEUTRAL_HEX_POP_RATIO);
}

/**
 * Стартовые соседи столицы: проходимые, с наибольшим лимитом населения,
 * при равенстве — по порядку направлений SE, NE, N, NW, SW, S.
 * @returns HexId соседей, START_HEXES − 1 штук (меньше, если проходимых соседей не хватает)
 */
export function pickStartNeighbors(state: MatchState, capital: Hex): HexId[] {
  const { map } = state;
  const candidates: { id: HexId; cap: number; order: number }[] = [];
  neighbors(capital).forEach((n, order) => {
    if (!inBounds(n, map.width, map.height)) return;
    const id = hexId(n, map.width);
    if (map.terrain[id] === TERRAIN.water) return;
    candidates.push({ id, cap: hexPopCap(state, id), order });
  });
  candidates.sort((a, b) => b.cap - a.cap || a.order - b.order);
  return candidates.slice(0, START_HEXES - 1).map((c) => c.id);
}

function addPlayer(state: MatchState, playerId: number, spawn: Hex): void {
  const capital = hexId(spawn, state.map.width);
  const cityId = state.nextId;
  state.nextId += 1;
  state.cities.push({
    id: cityId,
    hex: capital,
    owner: playerId,
    level: 1,
    name: '',
    garrison: 0 as Fp,
  });
  state.hexes.owner[capital] = playerId;
  state.hexes.pop[capital] = START_POP_CAPITAL;
  for (const id of pickStartNeighbors(state, spawn)) {
    state.hexes.owner[id] = playerId;
    state.hexes.pop[id] = START_POP_HEX;
  }
  state.players.push({
    id: playerId,
    gold: START_GOLD,
    taxTarget: TAX_DEFAULT,
    taxEffective: TAX_DEFAULT,
    capitalCityId: cityId,
    status: 'alive',
    citiesFounded: 0,
  });
  for (let i = 0; i < START_ARMIES; i += 1) {
    state.armies.push({
      id: state.nextId,
      owner: playerId,
      type: START_ARMY_TYPE,
      soldiers: START_ARMY_SOLDIERS,
      org: ORG_MAX,
      hex: capital,
      order: 'expand',
      supplyLevel: FP as Fp,
    });
    state.nextId += 1;
  }
}

/**
 * Стартовое состояние матча: спавны перемешиваются потоком RNG_STREAM.spawns,
 * игрок i получает i-й спавн после перемешивания (08-match.md, «Старт»).
 * @returns новое состояние на тике 0
 */
export function createMatch(
  map: MapStatic,
  players: readonly PlayerSetup[],
  seed: number,
): MatchState {
  if (players.length === 0 || players.length > map.spawns.length) {
    throw new RangeError(`игроков ${players.length}, спавнов на карте ${map.spawns.length}`);
  }
  const state = emptyState(map, seed);
  seedNeutralPopulation(state);
  const spawns = shuffle(fork(state.seed, RNG_STREAM.spawns), [...map.spawns]);
  players.forEach((_, playerId) => {
    const spawn = spawns[playerId];
    if (spawn) addPlayer(state, playerId, spawn);
  });
  state.cities.sort((a, b) => a.id - b.id);
  recomputeAllNetworks(state);
  return state;
}
