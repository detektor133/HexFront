// Команды планов армий (CR-002): assignFront, setDefenseLine, clearPlan, setOffensiveLine,
// stopOffensive.
// GDD: docs/gdd/07-controls.md — «Планы армий».
import { OK, rejected, type Command, type Validation } from './types.ts';
import { MAX_ACTIVE_ARROWS } from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import { defenseLinePath, frontHexes, offensiveLinePath } from '../state/front.ts';
import type { ArmyPlan, MatchState } from '../state/types.ts';

export type PlanCommand = Extract<
  Command,
  { t: 'assignFront' | 'setDefenseLine' | 'clearPlan' | 'setOffensiveLine' | 'stopOffensive' }
>;

function ownArmy(state: MatchState, playerId: number, armyId: number): Validation {
  const army = state.armies.find((a) => a.id === armyId);
  if (!army) return rejected('unknownArmy');
  return army.owner === playerId ? OK : rejected('notOwnArmy');
}

function validateFront(
  state: MatchState,
  playerId: number,
  cmd: Extract<PlanCommand, { t: 'assignFront' }>,
): Validation {
  const enemy = state.players[cmd.enemyId];
  if (!enemy || cmd.enemyId === playerId || enemy.status !== 'alive') return rejected('notEnemy');
  if (cmd.section === null) return OK;
  // Концы участка — гексы нынешней границы с этим соседом.
  const front = frontHexes(state, playerId, cmd.enemyId);
  return cmd.section.every((h) => front.includes(h)) ? OK : rejected('badHex');
}

function validateLine(state: MatchState, playerId: number, points: readonly number[]): Validation {
  if (points.length === 0) return rejected('badHex');
  if (points.some((h) => state.hexes.owner[h] !== playerId)) return rejected('notOwnHex');
  return defenseLinePath(state, playerId, points) ? OK : rejected('noPath');
}

// Наступление — только у армии с линией фронта; активных наступлений у игрока не больше
// MAX_ACTIVE_ARROWS (07-controls.md, «Линия наступления»).
function validateOffensive(
  state: MatchState,
  playerId: number,
  cmd: Extract<PlanCommand, { t: 'setOffensiveLine' }>,
): Validation {
  const plan = state.plans.find((p) => p.armyId === cmd.armyId);
  if (plan?.kind !== 'front') return rejected('noFront');
  const size = state.map.width * state.map.height;
  if (cmd.points.length === 0 || cmd.points.some((h) => h < 0 || h >= size)) {
    return rejected('badHex');
  }
  if (!offensiveLinePath(state, cmd.points)) return rejected('noPath');
  const mine = new Set(state.armies.filter((a) => a.owner === playerId).map((a) => a.id));
  const active = state.plans.filter(
    (p) => p.kind === 'front' && p.offensive && p.armyId !== cmd.armyId && mine.has(p.armyId),
  ).length;
  return active < MAX_ACTIVE_ARROWS ? OK : rejected('tooManyOffensives');
}

/**
 * Проверяет команду плана без изменения состояния.
 * @returns OK или отказ с причиной
 */
export function validatePlanCommand(
  state: MatchState,
  playerId: number,
  cmd: PlanCommand,
): Validation {
  const army = ownArmy(state, playerId, cmd.armyId);
  if (!army.ok) return army;
  if (cmd.t === 'assignFront') return validateFront(state, playerId, cmd);
  if (cmd.t === 'setDefenseLine') return validateLine(state, playerId, cmd.points);
  if (cmd.t === 'setOffensiveLine') return validateOffensive(state, playerId, cmd);
  return OK;
}

/** Снимает план армии; места отрядов освобождаются, отряды остаются, где стоят. */
export function removePlan(state: MatchState, armyId: number): void {
  const rest = state.plans.filter((p) => p.armyId !== armyId);
  state.plans.splice(0, state.plans.length, ...rest);
  for (const u of state.units) if (u.armyId === armyId) u.slot = -1;
}

/** Ставит или снимает линию наступления армии с фронтом; места отрядов не трогает. */
export function setOffensive(
  state: MatchState,
  armyId: number,
  line: readonly HexId[] | null,
): void {
  const i = state.plans.findIndex((p) => p.armyId === armyId);
  const plan = state.plans[i];
  if (plan?.kind === 'front') state.plans[i] = { ...plan, offensive: line };
}

function setPlan(state: MatchState, plan: ArmyPlan): void {
  removePlan(state, plan.armyId);
  state.plans.push(plan);
  state.plans.sort((a, b) => a.armyId - b.armyId);
}

/** Применяет команду плана. Вызывается только после успешной проверки. */
export function executePlanCommand(state: MatchState, playerId: number, cmd: PlanCommand): void {
  if (cmd.t === 'clearPlan') return removePlan(state, cmd.armyId);
  if (cmd.t === 'stopOffensive') return setOffensive(state, cmd.armyId, null);
  if (cmd.t === 'setOffensiveLine') {
    return setOffensive(state, cmd.armyId, offensiveLinePath(state, cmd.points));
  }
  if (cmd.t === 'assignFront') {
    const section = cmd.section ? ([cmd.section[0], cmd.section[1]] as const) : null;
    return setPlan(state, {
      armyId: cmd.armyId,
      kind: 'front',
      enemyId: cmd.enemyId,
      section,
      offensive: null,
    });
  }
  const hexes = defenseLinePath(state, playerId, cmd.points);
  if (hexes) setPlan(state, { armyId: cmd.armyId, kind: 'line', hexes });
}
