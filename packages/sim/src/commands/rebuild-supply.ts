// Команда rebuildSupply: платная прокладка пути от изолированного города к основной сети.
// GDD: docs/gdd/04-roads-supply.md — «Перестройка линий снабжения».
import { SUPPLY_REBUILD_COST_PER_HEX } from '../balance.ts';
import { OK, rejected, type RejectReason, type Validation } from './types.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';
import { findRoadPath } from '../queries/road-path.ts';
import { isCityIsolated } from '../state/network.ts';
import type { MatchState } from '../state/types.ts';
import { queueRoad } from '../systems/road-construction.ts';

/** План перестройки: путь от города до узла основной сети, гексы без дороги и цена. */
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

/**
 * Считает план перестройки снабжения без изменения состояния (кнопка и предпросмотр в UI).
 * @returns план с ценой в fixed-point золота или причина, почему перестройка недоступна
 */
export function rebuildSupplyPlan(
  state: MatchState,
  playerId: number,
  cityId: number,
): RebuildPlan {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) return fail('unknownCity');
  if (city.owner !== playerId) return fail('notOwnCity');
  // Авто-дорога или перестройка этого города уже идёт — второй раз платить за тот же путь нельзя.
  if (state.constructions.some((c) => c.kind === 'road' && c.hex === city.hex)) {
    return fail('alreadyBuilding');
  }
  if (!isCityIsolated(state, cityId)) return fail('notIsolated');
  const mainIds = new Set(
    state.networks.filter((n) => n.owner === playerId && n.isMain).map((n) => n.id),
  );
  const path = findRoadPath(state, playerId, city.hex, (h) =>
    mainIds.has(state.hexes.network[h] ?? -1),
  );
  if (!path) return fail('noPath');
  const cityHexes = new Set(state.cities.map((c) => c.hex));
  const toBuild = path.filter((h) => state.hexes.road[h] !== 1 && !cityHexes.has(h));
  // Кэш сетей отстаёт до 1 с: путь уже замощён — значит, город вот-вот станет связанным.
  if (toBuild.length === 0) return fail('notIsolated');
  const cost = (SUPPLY_REBUILD_COST_PER_HEX * toBuild.length) as Fp;
  const affordable = (state.players[playerId]?.gold ?? 0) >= cost;
  return { ok: true, cityHex: city.hex, path, toBuild, cost, affordable };
}

/**
 * Проверяет команду rebuildSupply.
 * @returns OK или отказ с причиной
 */
export function validateRebuildSupply(
  state: MatchState,
  playerId: number,
  cityId: number,
): Validation {
  const plan = rebuildSupplyPlan(state, playerId, cityId);
  if (!plan.ok) return rejected(plan.reason);
  return plan.affordable ? OK : rejected('notEnoughGold');
}

/** Списывает золото и ставит прокладку пути в очередь. Вызывается после успешной проверки. */
export function startRebuildSupply(state: MatchState, playerId: number, cityId: number): void {
  const plan = rebuildSupplyPlan(state, playerId, cityId);
  const player = state.players[playerId];
  if (!plan.ok || !plan.affordable || !player) return;
  player.gold = (player.gold - plan.cost) as Fp;
  queueRoad(state, playerId, plan.cityHex, plan.path);
}
