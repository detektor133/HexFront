// Морская переправа (03-cities-buildings.md, «Порты»): отряды в порту отплывают в другой свой порт
// бесплатно или на любой берег в пределах дальности за золото по числу солдат и длине пути.
import { OK, rejected, type Validation } from './types.ts';
import { PORT_CAPACITY_PER_LEVEL, SEA_COST_PER_SOLDIER_HEX } from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import { fpMul, type Fp } from '../math/int.ts';
import { planSeaRoute } from '../queries/sea-route.ts';
import { peaceBlocked } from '../queries/unit-path.ts';
import { depotLevel } from '../state/depot.ts';
import { isPortOf, type PortGround } from '../state/port.ts';
import type { MatchState, Unit } from '../state/types.ts';

/** Аргументы переправы: отряды в порту и гекс назначения (свой порт или берег). */
export interface SailCommand {
  readonly unitIds: readonly number[];
  readonly to: HexId;
}

/** Вместимость порта за одну отправку, fixed-point солдат: растёт с уровнем склада (код здания). */
export function portCapacity(building: number): number {
  return PORT_CAPACITY_PER_LEVEL * depotLevel(building);
}

/**
 * Стоимость переправы в золоте, fixed-point: в свой порт бесплатно, на прочий берег — солдаты ×
 * длина пути по воде × цена.
 */
export function sailCost(
  g: PortGround,
  playerId: number,
  units: readonly { readonly soldiers: Fp }[],
  to: HexId,
  seaHexes: number,
): number {
  if (isPortOf(g, playerId, to)) return 0;
  let gold = 0;
  for (const u of units) gold += fpMul(u.soldiers, SEA_COST_PER_SOLDIER_HEX) * seaHexes;
  return gold;
}

function sailors(state: MatchState, playerId: number, ids: readonly number[]): Unit[] | null {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return null;
  const units: Unit[] = [];
  for (const id of ids) {
    const u = state.units.find((x) => x.id === id);
    if (!u || u.owner !== playerId) return null;
    units.push(u);
  }
  return units;
}

/**
 * Проверяет переправу: все отряды свои, стоят вместе в своём порту и свободны; путь по воде
 * существует; отряды влезают в порт; золота хватает.
 * @returns OK или отказ с причиной
 */
export function validateSail(state: MatchState, playerId: number, cmd: SailCommand): Validation {
  const units = sailors(state, playerId, cmd.unitIds);
  if (!units) return rejected('unknownUnit');
  const from = units[0]?.hex ?? -1;
  if (units.some((u) => u.hex !== from)) return rejected('notSameHex');
  if (units.some((u) => u.order === 'retreat' || u.sea || u.inBattle)) return rejected('badOrder');
  if (!isPortOf(state, playerId, from)) return rejected('notAtPort');
  if (!Number.isInteger(cmd.to) || cmd.to < 0 || cmd.to >= state.hexes.owner.length) {
    return rejected('badHex');
  }
  if (peaceBlocked(state, playerId, cmd.to)) return rejected('noPath');
  const route = planSeaRoute(state.map, from, cmd.to);
  if (!route) return rejected('noSeaPath');
  const soldiers = units.reduce((sum, u) => sum + u.soldiers, 0);
  if (soldiers > portCapacity(state.hexes.building[from] ?? 0)) return rejected('portCapacity');
  const cost = sailCost(state, playerId, units, cmd.to, route.length - 1);
  const player = state.players[playerId];
  if (cost > 0 && (!player || player.bankrupt || player.gold < cost)) {
    return rejected('notEnoughGold');
  }
  return OK;
}

/** Списывает плату и отправляет отряды по воде. Вызывается после успешной проверки. */
export function executeSail(state: MatchState, playerId: number, cmd: SailCommand): void {
  const units = sailors(state, playerId, cmd.unitIds);
  const from = units?.[0]?.hex;
  if (!units || from === undefined) return;
  const route = planSeaRoute(state.map, from, cmd.to);
  const player = state.players[playerId];
  if (!route || !player) return;
  player.gold = (player.gold - sailCost(state, playerId, units, cmd.to, route.length - 1)) as Fp;
  for (const u of units) {
    u.sea = true;
    u.path = [...route];
    u.moveTicks = 0;
    u.moveTotal = 0;
    u.order = 'move';
    u.slot = -1;
    u.gather = -1;
  }
}
