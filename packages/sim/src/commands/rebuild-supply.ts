// Команда rebuildSupply: платная прокладка пути от изолированного города или склада к сети.
// GDD: docs/gdd/04-roads-supply.md — «Перестройка линий снабжения».
import { SUPPLY_REBUILD_COST_PER_HEX } from '../balance.ts';
import { OK, rejected, type RejectReason, type Validation } from './types.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';
import { findRoadPath } from '../queries/road-path.ts';
import { isCityIsolated, mainNetworkMask } from '../state/network.ts';
import { BUILDING, type MatchState } from '../state/types.ts';
import { queueRoad } from '../systems/road-construction.ts';

/** План перестройки: путь от изолированного объекта до узла основной сети и цена. */
export type RebuildPlan =
  | {
      readonly ok: true;
      readonly cityHex: HexId;
      readonly path: readonly HexId[];
      readonly toBuild: readonly HexId[];
      readonly cost: Fp;
      /** Хватает ли золота; предпросмотр показывает цену и без него (ui.md). */
      readonly affordable: boolean;
    }
  | { readonly ok: false; readonly reason: RejectReason };

const fail = (reason: RejectReason): RebuildPlan => ({ ok: false, reason });

export type RebuildTarget = { readonly cityId: number } | { readonly hex: HexId };

/**
 * Считает план перестройки снабжения без изменения состояния (кнопка и предпросмотр в UI).
 * @returns план с ценой в fixed-point золота или причина, почему перестройка недоступна
 */
export function rebuildSupplyPlan(
  state: MatchState,
  playerId: number,
  target: number | RebuildTarget,
): RebuildPlan {
  const normalized: RebuildTarget = typeof target === 'number' ? { cityId: target } : target;
  let hex: HexId;
  if ('cityId' in normalized) {
    const city = state.cities.find((candidate) => candidate.id === normalized.cityId);
    if (!city) return fail('unknownCity');
    if (city.owner !== playerId) return fail('notOwnCity');
    if (!isCityIsolated(state, city.id)) return fail('notIsolated');
    hex = city.hex;
  } else {
    if (
      !Number.isInteger(normalized.hex) ||
      normalized.hex < 0 ||
      normalized.hex >= state.hexes.owner.length ||
      state.hexes.owner[normalized.hex] !== playerId ||
      state.hexes.building[normalized.hex] !== BUILDING.depot
    ) {
      return fail('unknownDepot');
    }
    if (mainNetworkMask(state, playerId)[normalized.hex] === 1) return fail('notIsolated');
    hex = normalized.hex;
  }
  // Авто-дорога или перестройка этого объекта уже идёт — второй раз платить нельзя.
  if (state.constructions.some((c) => c.kind === 'road' && c.hex === hex)) {
    return fail('alreadyBuilding');
  }
  const mainIds = new Set(
    state.networks.filter((n) => n.owner === playerId && n.isMain).map((n) => n.id),
  );
  const path = findRoadPath(state, playerId, hex, (h) => mainIds.has(state.hexes.network[h] ?? -1));
  if (!path) return fail('noPath');
  const cityHexes = new Set(state.cities.map((c) => c.hex));
  const toBuild = path.filter((h) => state.hexes.road[h] !== 1 && !cityHexes.has(h));
  // Кэш сетей отстаёт до 1 с: путь уже замощён — значит, город вот-вот станет связанным.
  if (toBuild.length === 0) return fail('notIsolated');
  const cost = (SUPPLY_REBUILD_COST_PER_HEX * toBuild.length) as Fp;
  const affordable = (state.players[playerId]?.gold ?? 0) >= cost;
  return { ok: true, cityHex: hex, path, toBuild, cost, affordable };
}

/**
 * Проверяет команду rebuildSupply.
 * @returns OK или отказ с причиной
 */
export function validateRebuildSupply(
  state: MatchState,
  playerId: number,
  target: RebuildTarget,
): Validation {
  const plan = rebuildSupplyPlan(state, playerId, target);
  if (!plan.ok) return rejected(plan.reason);
  if (state.players[playerId]?.bankrupt) return rejected('bankrupt');
  return plan.affordable ? OK : rejected('notEnoughGold');
}

/** Списывает золото и ставит прокладку пути в очередь. Вызывается после успешной проверки. */
export function startRebuildSupply(
  state: MatchState,
  playerId: number,
  target: RebuildTarget,
): void {
  const plan = rebuildSupplyPlan(state, playerId, target);
  const player = state.players[playerId];
  if (!plan.ok || !plan.affordable || !player) return;
  player.gold = (player.gold - plan.cost) as Fp;
  queueRoad(state, playerId, plan.cityHex, plan.path);
}
