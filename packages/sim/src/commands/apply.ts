// Проверка и применение команд — первый шаг тика (sim-core.md, «Порядок систем», п. 1).
import { executeArmyCommand, validateArmyCommand } from './army.ts';
import { stillAuto, takeOver } from './auto.ts';
import { executeBuildRoad, validateBuildRoad } from './build-road.ts';
import { startConstruction, validateConstruction } from './construction.ts';
import { executeDiplomacy, validateDiplomacy } from './diplomacy.ts';
import { executeHold, executeLaunch, validateHold, validateLaunch } from './launch.ts';
import { executePlanCommand, validatePlanCommand } from './plan.ts';
import { startRebuildSupply, validateRebuildSupply } from './rebuild-supply.ts';
import { startRecruit, validateRecruit } from './recruit.ts';
import { executeRenameCity, validateRenameCity } from './rename-city.ts';
import { executeSail, validateSail } from './sail.ts';
import { validateSetTax } from './set-tax.ts';
import { rejected, type Command, type PlayerCommand, type Validation } from './types.ts';
import { executeUnitCommand, validateUnitCommand } from './unit.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import type { MatchState } from '../state/types.ts';

export type { PlayerCommand } from './types.ts';

// Отряд, которому игрок отдал приказ вручную, снимается с плана армии и остаётся свободным, пока
// его не передадут в армию заново или не снимут план (решение владельца 2026-11-03): иначе после
// приказа он возвращался к плану и сливался обратно.
function unitIdsOf(cmd: Command): readonly number[] {
  if ('unitIds' in cmd) return cmd.unitIds;
  return 'unitId' in cmd ? [cmd.unitId] : [];
}

function hasPlan(state: MatchState, armyId: number | null): boolean {
  return armyId !== null && state.plans.some((p) => p.armyId === armyId);
}

function detachOrdered(state: MatchState, cmd: Command): void {
  if (cmd.t !== 'move' && cmd.t !== 'attack' && cmd.t !== 'gather') return;
  for (const u of state.units) {
    if (cmd.unitIds.includes(u.id) && u.slot === -1 && hasPlan(state, u.armyId)) {
      u.slot = SLOT_DETACHED;
    }
  }
}

function assertNever(x: never): never {
  throw new Error(`неизвестная команда: ${JSON.stringify(x)}`);
}

// Команды, чья механика появится в следующих этапах, пока отклоняются как notImplemented.
function validateCommand(state: MatchState, playerId: number, cmd: Command): Validation {
  switch (cmd.t) {
    case 'setTax':
      return validateSetTax(cmd.rate);
    case 'foundCity':
    case 'upgradeCity':
    case 'improve':
    case 'build':
      return validateConstruction(state, playerId, cmd);
    case 'rebuildSupply':
      return validateRebuildSupply(
        state,
        playerId,
        'cityId' in cmd ? { cityId: cmd.cityId } : { hex: cmd.hex },
      );
    case 'recruit': {
      const army = cmd.armyId === undefined ? null : state.armies.find((a) => a.id === cmd.armyId);
      if (army === undefined) return rejected('unknownArmy');
      if (army && army.owner !== playerId) return rejected('notOwnArmy');
      return validateRecruit(state, playerId, cmd.cityId, cmd.type, cmd.soldiers);
    }
    case 'move':
    case 'attack':
    case 'stop':
    case 'gather':
    case 'split':
    case 'merge':
    case 'bombard':
      return validateUnitCommand(state, playerId, cmd);
    case 'declareWar':
    case 'proposeTreaty':
    case 'answerTreaty':
    case 'breakTreaty':
      return validateDiplomacy(state, playerId, cmd);
    case 'renameCity':
      return validateRenameCity(state, playerId, cmd);
    case 'buildRoad':
      return validateBuildRoad(state, playerId, cmd);
    case 'sail':
      return validateSail(state, playerId, cmd);
    case 'launchOffensive':
      return validateLaunch(state, playerId, cmd);
    case 'holdBorder':
      return validateHold(state, playerId, cmd);
    case 'createArmy':
    case 'renameArmy':
    case 'disbandArmy':
    case 'splitArmy':
    case 'setArmyLimit':
    case 'assignUnits':
    case 'setAutoReinforce':
    case 'setArmyAuto':
    case 'setAutoCommand':
      return validateArmyCommand(state, playerId, cmd);
    case 'assignFront':
    case 'setDefenseLine':
    case 'clearPlan':
    case 'setOffensiveLine':
    case 'startOffensive':
    case 'stopOffensive':
    case 'clearOffensive':
      return validatePlanCommand(state, playerId, cmd);
    default:
      return assertNever(cmd);
  }
}

function execute(state: MatchState, playerId: number, cmd: Command): void {
  switch (cmd.t) {
    case 'setTax': {
      const player = state.players[playerId];
      if (player) player.taxTarget = cmd.rate;
      return;
    }
    case 'foundCity':
    case 'upgradeCity':
    case 'improve':
    case 'build':
      startConstruction(state, playerId, cmd);
      return;
    case 'rebuildSupply':
      startRebuildSupply(
        state,
        playerId,
        'cityId' in cmd ? { cityId: cmd.cityId } : { hex: cmd.hex },
      );
      return;
    case 'recruit':
      startRecruit(state, playerId, cmd.cityId, cmd.type, cmd.soldiers, cmd.armyId);
      return;
    case 'move':
    case 'attack':
    case 'stop':
    case 'gather':
    case 'split':
    case 'merge':
    case 'bombard':
      executeUnitCommand(state, playerId, cmd);
      return;
    case 'declareWar':
    case 'proposeTreaty':
    case 'answerTreaty':
    case 'breakTreaty':
      executeDiplomacy(state, playerId, cmd);
      return;
    case 'renameCity':
      executeRenameCity(state, cmd);
      return;
    case 'buildRoad':
      executeBuildRoad(state, playerId, cmd);
      return;
    case 'sail':
      executeSail(state, playerId, cmd);
      return;
    case 'launchOffensive':
      executeLaunch(state, playerId, cmd);
      return;
    case 'holdBorder':
      executeHold(state, playerId, cmd);
      return;
    case 'createArmy':
    case 'renameArmy':
    case 'disbandArmy':
    case 'splitArmy':
    case 'setArmyLimit':
    case 'assignUnits':
    case 'setAutoReinforce':
    case 'setArmyAuto':
    case 'setAutoCommand':
      executeArmyCommand(state, playerId, cmd);
      return;
    case 'assignFront':
    case 'setDefenseLine':
    case 'clearPlan':
    case 'setOffensiveLine':
    case 'startOffensive':
    case 'stopOffensive':
    case 'clearOffensive':
      executePlanCommand(state, playerId, cmd);
      return;
    default:
      return;
  }
}

/**
 * Проверяет команду игрока, не меняя состояние.
 * @returns OK или отказ с причиной
 */
export function validate(state: MatchState, playerId: number, cmd: Command): Validation {
  const player = state.players[playerId];
  if (!player) return rejected('unknownPlayer');
  if (player.status !== 'alive') return rejected('playerEliminated');
  return validateCommand(state, playerId, cmd);
}

/**
 * Применяет команды по порядку: по playerId, внутри игрока — сначала ручные, потом команды
 * commander, каждые — по порядку поступления. Команда commander для армии, у которой auto уже
 * выключен (в том числе ручной командой этого же тика), отклоняется. Отклонённые не меняют
 * состояние и попадают в state.events.
 */
export function applyCommands(state: MatchState, commands: readonly PlayerCommand[]): void {
  // sort стабилен (ES2019), поэтому порядок поступления внутри игрока сохраняется.
  const auto = (c: PlayerCommand): number => (c.source === 'auto' ? 1 : 0);
  const ordered = [...commands].sort((a, b) => a.playerId - b.playerId || auto(a) - auto(b));
  // Отряды, которым игрок отдал ручной приказ в этом тике: устаревшее решение commander по ним
  // не применяется — ручное побеждает.
  const manual = new Set<number>();
  for (const { playerId, cmd, source } of ordered) {
    const ids = unitIdsOf(cmd);
    const stale = source === 'auto' && ids.some((id) => manual.has(id));
    const result =
      source === 'auto' && (stale || !stillAuto(state, cmd))
        ? rejected('notAuto')
        : validate(state, playerId, cmd);
    if (result.ok && source !== 'auto') for (const id of ids) manual.add(id);
    // Ручное действие игрока с армией выключает её автокомандование (CR-006).
    if (result.ok && source !== 'auto') takeOver(state, cmd);
    if (result.ok) {
      execute(state, playerId, cmd);
      if (source !== 'auto') detachOrdered(state, cmd);
    } else {
      const auto = source === 'auto';
      state.events.push({
        t: 'commandRejected',
        playerId,
        command: cmd.t,
        reason: result.reason,
        auto,
      });
    }
  }
}
