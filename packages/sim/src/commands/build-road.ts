// Дорога вручную (04-roads-supply.md, «Дорога вручную»): игрок задаёт точки, дорога прокладывается
// от первой к последней по своей земле. Цена — как у перестройки снабжения, за каждый новый гекс.
import { OK, rejected, type Validation } from './types.ts';
import { SUPPLY_REBUILD_COST_PER_HEX } from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';
import { planRoadRoute, roadEndsAreNodes } from '../queries/road-route.ts';
import { isDepot } from '../state/depot.ts';
import type { MatchState } from '../state/types.ts';
import { ROAD_TICKS_PER_HEX } from '../systems/road-construction.ts';

/** Узлы сети игрока, между которыми прокладывается дорога: его города и склады. */
export function roadNodes(state: MatchState, playerId: number): Set<HexId> {
  const nodes = new Set<HexId>();
  for (const city of state.cities) if (city.owner === playerId) nodes.add(city.hex);
  for (let h = 0; h < state.hexes.owner.length; h += 1) {
    if (state.hexes.owner[h] === playerId && isDepot(state.hexes.building[h] ?? 0)) nodes.add(h);
  }
  return nodes;
}

function routeOf(state: MatchState, playerId: number, points: readonly HexId[]) {
  const cityHexes = new Set(state.cities.map((c) => c.hex));
  return planRoadRoute(state, playerId, points, cityHexes);
}

/**
 * Проверяет прокладку дороги по точкам.
 * @returns OK или отказ с причиной
 */
export function validateBuildRoad(
  state: MatchState,
  playerId: number,
  cmd: { readonly points: readonly HexId[] },
): Validation {
  if (!Array.isArray(cmd.points)) return rejected('badHex');
  const route = routeOf(state, playerId, cmd.points);
  if (!route.ok) return rejected(route.reason);
  if (!roadEndsAreNodes(cmd.points, roadNodes(state, playerId))) return rejected('roadNeedsNodes');
  const player = state.players[playerId];
  if (!player || player.bankrupt) return rejected('bankrupt');
  const cost = SUPPLY_REBUILD_COST_PER_HEX * route.toBuild.length;
  return player.gold >= cost ? OK : rejected('notEnoughGold');
}

/** Списывает золото и ставит дорогу в очередь стройки. Вызывается после успешной проверки. */
export function executeBuildRoad(
  state: MatchState,
  playerId: number,
  cmd: { readonly points: readonly HexId[] },
): void {
  const route = routeOf(state, playerId, cmd.points);
  const player = state.players[playerId];
  if (!route.ok || !player) return;
  player.gold = (player.gold - SUPPLY_REBUILD_COST_PER_HEX * route.toBuild.length) as Fp;
  state.constructions.push({
    id: state.nextId,
    owner: playerId,
    hex: route.path[0] as HexId,
    kind: 'road',
    progressTicks: 0,
    totalTicks: route.toBuild.length * ROAD_TICKS_PER_HEX,
    path: route.toBuild,
    manual: true,
  });
  state.nextId += 1;
}
