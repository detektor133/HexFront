// Версии слоёв состояния. Единственное место, где меняются слои гексов (улучшения, постройки,
// дороги), города и сети: каждая запись повышает версию слоя, а кэши производных данных
// (state/derived.ts) пересчитываются, только если версия изменилась. Менять слои в обход этих
// функций нельзя (ESLint), а забытое повышение версии ловит аудит кэшей (derived.ts, тесты).
// Архитектура: docs/architecture/performance.md, «Версии слоёв и кэши».
import type { City, MatchState } from './types.ts';
import type { HexId } from '../math/hex.ts';

/** Слои состояния, от которых зависят кэши. Владелец гекса меняется через setHexOwner. */
export type Layer = 'owner' | 'improvement' | 'building' | 'road' | 'cities' | 'networks';

type Revisions = Record<Layer, number>;

const revisions = new WeakMap<MatchState, Revisions>();

function revisionsOf(state: MatchState): Revisions {
  let current = revisions.get(state);
  if (current === undefined) {
    current = { owner: 0, improvement: 0, building: 0, road: 0, cities: 0, networks: 0 };
    revisions.set(state, current);
  }
  return current;
}

/**
 * Версия слоя: растёт при каждом изменении слоя.
 * @returns неотрицательное целое; сравнивать только на равенство
 */
export function layerRevision(state: MatchState, layer: Layer): number {
  return revisionsOf(state)[layer];
}

/** Отмечает, что слой изменился (для изменений, которые идут не через функции этого файла). */
export function touchLayer(state: MatchState, layer: Layer): void {
  revisionsOf(state)[layer] += 1;
}

// Память тумана игрока (последние виденные дороги, улучшения, постройки): у каждого своя версия.
const memoryRevisions = new WeakMap<MatchState, number[]>();

/** Версия памяти тумана игрока; растёт, когда игрок увидел изменение в памяти. */
export function memoryRevision(state: MatchState, playerId: number): number {
  return memoryRevisions.get(state)?.[playerId] ?? 0;
}

/** Отмечает, что память тумана игрока изменилась. */
export function touchMemory(state: MatchState, playerId: number): void {
  let current = memoryRevisions.get(state);
  if (current === undefined) {
    current = [];
    memoryRevisions.set(state, current);
  }
  current[playerId] = (current[playerId] ?? 0) + 1;
}

/** Задаёт уровень улучшения гекса. */
export function setImprovement(state: MatchState, hex: HexId, level: number): void {
  if (state.hexes.improvement[hex] === level) return;
  state.hexes.improvement[hex] = level;
  touchLayer(state, 'improvement');
}

/** Задаёт код постройки гекса (форт, склад). */
export function setBuilding(state: MatchState, hex: HexId, code: number): void {
  if (state.hexes.building[hex] === code) return;
  state.hexes.building[hex] = code;
  touchLayer(state, 'building');
}

/** Задаёт признак дороги на гексе. */
export function setRoad(state: MatchState, hex: HexId, value: 0 | 1): void {
  if (state.hexes.road[hex] === value) return;
  state.hexes.road[hex] = value;
  touchLayer(state, 'road');
}

/** Добавляет город в матч. */
export function addCity(state: MatchState, city: City): void {
  state.cities.push(city);
  touchLayer(state, 'cities');
}

/** Меняет уровень города. */
export function setCityLevel(state: MatchState, city: City, level: number): void {
  if (city.level === level) return;
  city.level = level;
  touchLayer(state, 'cities');
}

/** Меняет владельца города (захват). */
export function setCityOwner(state: MatchState, city: City, owner: number): void {
  if (city.owner === owner) return;
  city.owner = owner;
  touchLayer(state, 'cities');
}
