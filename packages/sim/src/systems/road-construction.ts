// Прокладка дорог гекс за гексом: авто-дорога после основания города (и перестройка снабжения, 02/T8).
// GDD: docs/gdd/04-roads-supply.md — «Дороги», «Перестройка линий снабжения».
import { ROAD_BUILD_S_PER_HEX, TICKS_PER_S } from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';
import { findRoadPath } from '../queries/road-path.ts';
import { mainNetworkMask } from '../state/network.ts';
import type { Construction, MatchState } from '../state/types.ts';

/** Тиков на один гекс дороги. */
export const ROAD_TICKS_PER_HEX = intDiv(ROAD_BUILD_S_PER_HEX * TICKS_PER_S, FP);

/** Ставит в очередь прокладку дороги по гексам, где её ещё нет. */
export function queueRoad(
  state: MatchState,
  owner: number,
  anchor: HexId,
  path: readonly HexId[],
): void {
  const cityHexes = new Set(state.cities.map((c) => c.hex));
  const toBuild = path.filter((h) => state.hexes.road[h] !== 1 && !cityHexes.has(h));
  if (toBuild.length === 0) return;
  state.constructions.push({
    id: state.nextId,
    owner,
    hex: anchor,
    kind: 'road',
    progressTicks: 0,
    totalTicks: toBuild.length * ROAD_TICKS_PER_HEX,
    path: toBuild,
  });
  state.nextId += 1;
}

/**
 * Авто-дорога нового города: кратчайший путь по своей земле до ближайшего города основной сети.
 * Нет пути — город остаётся изолированным.
 */
export function queueAutoRoad(state: MatchState, owner: number, cityHex: HexId): void {
  const mask = mainNetworkMask(state, owner);
  if (mask[cityHex] === 1) return;
  const mainCities = new Set(
    state.cities.filter((c) => c.owner === owner && mask[c.hex] === 1).map((c) => c.hex),
  );
  const path = findRoadPath(state, owner, cityHex, (h) => mainCities.has(h));
  if (path) queueRoad(state, owner, cityHex, path);
}

/** Строится ли ещё хоть один гекс пути; потерянный непостроенный гекс отменяет прокладку. */
export function roadLost(state: MatchState, c: Construction): boolean {
  const built = intDiv(c.progressTicks, ROAD_TICKS_PER_HEX);
  return (c.path ?? []).slice(built).some((h) => state.hexes.owner[h] !== c.owner);
}

/** Тик прокладки: каждые ROAD_TICKS_PER_HEX тиков появляется следующий гекс дороги. */
export function advanceRoad(state: MatchState, c: Construction): void {
  c.progressTicks += 1;
  if (c.progressTicks % ROAD_TICKS_PER_HEX !== 0) return;
  const hex = c.path?.[intDiv(c.progressTicks, ROAD_TICKS_PER_HEX) - 1];
  if (hex !== undefined) state.hexes.road[hex] = 1;
}
