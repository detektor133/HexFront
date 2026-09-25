// Команды планов армий (CR-002): assignFront, setDefenseLine, clearPlan.
// GDD: docs/gdd/07-controls.md — «Планы армий».
import { OK, rejected, type Command, type Validation } from './types.ts';
import { defenseLinePath, frontHexes } from '../state/front.ts';
import type { ArmyPlan, MatchState } from '../state/types.ts';

export type PlanCommand = Extract<Command, { t: 'assignFront' | 'setDefenseLine' | 'clearPlan' }>;

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
  return OK;
}

/** Снимает план армии; места отрядов освобождаются, отряды остаются, где стоят. */
export function removePlan(state: MatchState, armyId: number): void {
  const rest = state.plans.filter((p) => p.armyId !== armyId);
  state.plans.splice(0, state.plans.length, ...rest);
  for (const u of state.units) if (u.armyId === armyId) u.slot = -1;
}

function setPlan(state: MatchState, plan: ArmyPlan): void {
  removePlan(state, plan.armyId);
  state.plans.push(plan);
  state.plans.sort((a, b) => a.armyId - b.armyId);
}

/** Применяет команду плана. Вызывается только после успешной проверки. */
export function executePlanCommand(state: MatchState, playerId: number, cmd: PlanCommand): void {
  if (cmd.t === 'clearPlan') return removePlan(state, cmd.armyId);
  if (cmd.t === 'assignFront') {
    const section = cmd.section ? ([cmd.section[0], cmd.section[1]] as const) : null;
    return setPlan(state, { armyId: cmd.armyId, kind: 'front', enemyId: cmd.enemyId, section });
  }
  const hexes = defenseLinePath(state, playerId, cmd.points);
  if (hexes) setPlan(state, { armyId: cmd.armyId, kind: 'line', hexes });
}
