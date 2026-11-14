// Морское вторжение армии (03-cities-buildings.md, «Порты»): армия снимается со старого приказа и
// получает новый — идти в порт отправки, сесть на корабли очередью и высадиться на заданном
// берегу. Золото списывается сразу по солдатам армии и длине пути по воде (в свой порт бесплатно).
import { removePlan } from './plan.ts';
import { releaseDirection } from './release.ts';
import { sailCost } from './sail.ts';
import { OK, rejected, type Validation } from './types.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';
import { planSeaRoute } from '../queries/sea-route.ts';
import { findPath, peaceBlocked } from '../queries/unit-path.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { isPortOf } from '../state/port.ts';
import type { MatchState, Unit } from '../state/types.ts';

/** Аргументы вторжения: армия, порт отправки и гекс высадки. */
export interface InvadeCommand {
  readonly armyId: number;
  readonly from: HexId;
  readonly to: HexId;
}

interface Plan {
  readonly unit: Unit;
  readonly path: HexId[];
}

// Отряды армии, которые дойдут до порта, и их пути до высадки; артиллерия идёт вместе со всеми.
function plans(state: MatchState, cmd: InvadeCommand, sea: readonly HexId[]): Plan[] {
  const out: Plan[] = [];
  for (const u of state.units) {
    if (u.armyId !== cmd.armyId || u.sea || u.order === 'retreat' || u.inBattle) continue;
    const toPort = u.hex === cmd.from ? [] : findPath(state, u.hex, cmd.from, u.type, u.owner);
    if (toPort) out.push({ unit: u, path: [...toPort, ...sea] });
  }
  return out;
}

/**
 * Проверяет вторжение: армия своя, порт отправки свой, до берега есть путь по воде, война с
 * владельцем берега, у армии есть отряды, дошедшие до порта, и хватает золота.
 * @returns OK или отказ с причиной
 */
export function validateInvade(
  state: MatchState,
  playerId: number,
  cmd: InvadeCommand,
): Validation {
  const army = state.armies.find((a) => a.id === cmd.armyId);
  if (!army) return rejected('unknownArmy');
  if (army.owner !== playerId) return rejected('notOwnArmy');
  if (!isPortOf(state, playerId, cmd.from)) return rejected('notAtPort');
  if (!Number.isInteger(cmd.to) || cmd.to < 0 || cmd.to >= state.hexes.owner.length) {
    return rejected('badHex');
  }
  if (peaceBlocked(state, playerId, cmd.to)) return rejected('needWar');
  const route = planSeaRoute(state.map, cmd.from, cmd.to);
  if (!route) return rejected('noSeaPath');
  const sailors = plans(state, cmd, route);
  if (sailors.length === 0) return rejected('noPath');
  const cost = sailCost(
    state,
    playerId,
    sailors.map((p) => p.unit),
    cmd.to,
    route.length - 1,
  );
  const player = state.players[playerId];
  if (cost > 0 && (!player || player.bankrupt || player.gold < cost)) {
    return rejected('notEnoughGold');
  }
  return OK;
}

/** Снимает армию со старого приказа, списывает плату и отправляет отряды. После проверки. */
export function executeInvade(state: MatchState, playerId: number, cmd: InvadeCommand): void {
  const army = state.armies.find((a) => a.id === cmd.armyId);
  const route = planSeaRoute(state.map, cmd.from, cmd.to);
  const player = state.players[playerId];
  if (!army || !route || !player) return;
  const sailors = plans(state, cmd, route);
  const cost = sailCost(
    state,
    playerId,
    sailors.map((p) => p.unit),
    cmd.to,
    route.length - 1,
  );
  player.gold = (player.gold - cost) as Fp;
  // Старый приказ (фронт, наступление, занятие) снят, автокомандование выключено: вторжение ручное.
  releaseDirection(state, army);
  removePlan(state, army.id);
  army.auto = false;
  army.invading = true;
  // По высадке армия сама встанет на плацдарм: фронт у границы с хозяином берега и наступление.
  army.landing = { hex: cmd.to, target: state.hexes.owner[cmd.to] ?? -1 };
  for (const { unit, path } of sailors) {
    unit.slot = SLOT_DETACHED;
    unit.gather = -1;
    unit.path = path;
    unit.moveTicks = 0;
    unit.moveTotal = 0;
    unit.order = 'move';
  }
}
