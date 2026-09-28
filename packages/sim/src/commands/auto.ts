// Что выключает автокомандование армии (CR-006; gdd/07-controls.md, «Автокомандование»): ручное
// действие игрока с армией — планы, деление и слияние, приказы её отрядам, передача отрядов.
// ▶ «Начать», ■ «Стоп», переименование и команды самого commander (source 'auto') — не выключают.
import type { Command } from './types.ts';
import type { MatchState } from '../state/types.ts';

// Армии отрядов (до применения команды: слияние и передача меняют состав).
function armiesOf(state: MatchState, unitIds: readonly number[]): number[] {
  const out: number[] = [];
  for (const u of state.units) {
    if (u.armyId !== null && unitIds.includes(u.id) && !out.includes(u.armyId)) out.push(u.armyId);
  }
  return out;
}

/**
 * Армии, у которых ручная команда выключает auto.
 * @returns id армий по возрастанию, без повторов
 */
export function armiesTakenOver(state: MatchState, cmd: Command): number[] {
  return touched(state, cmd).sort((a, b) => a - b);
}

function touched(state: MatchState, cmd: Command): number[] {
  switch (cmd.t) {
    case 'assignFront':
    case 'setOffensiveLine':
    case 'clearOffensive':
    case 'setDefenseLine':
    case 'clearPlan':
      return [cmd.armyId];
    case 'move':
    case 'attack':
    case 'merge':
      return armiesOf(state, cmd.unitIds);
    case 'split':
    case 'bombard':
      return armiesOf(state, [cmd.unitId]);
    case 'assignUnits': {
      const ids = armiesOf(state, cmd.unitIds);
      return cmd.armyId === null || ids.includes(cmd.armyId) ? ids : [...ids, cmd.armyId];
    }
    default:
      return [];
  }
}

/** Выключает auto у армий, которые ручная команда взяла под управление игрока. */
export function takeOver(state: MatchState, cmd: Command): void {
  const ids = armiesTakenOver(state, cmd);
  for (const a of state.armies) if (ids.includes(a.id)) a.auto = false;
}
