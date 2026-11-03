// Что выключает автокомандование армии (CR-006; gdd/07-controls.md, «Автокомандование»): ручное
// действие игрока с планом армии (фронт, линии). Действия с отрядами auto не выключают.
// ▶ «Начать», ■ «Стоп», переименование и команды самого commander (source 'auto') — не выключают.
import type { Command } from './types.ts';
import type { MatchState } from '../state/types.ts';

/**
 * Армии, у которых ручная команда выключает auto.
 * @returns id армий по возрастанию, без повторов
 */
export function armiesTakenOver(state: MatchState, cmd: Command): number[] {
  return touched(state, cmd).sort((a, b) => a - b);
}

function touched(_state: MatchState, cmd: Command): number[] {
  switch (cmd.t) {
    case 'assignFront':
    case 'setOffensiveLine':
    case 'clearOffensive':
    case 'setDefenseLine':
    case 'clearPlan':
      return [cmd.armyId];
    // Приказы отрядам, деление, слияние и передача auto не выключают (решение владельца
    // 2026-11-03): ручное действие с отрядом — исключение для него, а не отказ от автокомандования.
    default:
      return [];
  }
}

/**
 * Команду commander ещё можно применить: все армии, которых она касается, — с auto. Ручная команда
 * того же тика применяется раньше и могла выключить auto — тогда решение commander устарело.
 */
export function stillAuto(state: MatchState, cmd: Command): boolean {
  const ids = touched(state, cmd);
  if ('armyId' in cmd && typeof cmd.armyId === 'number') ids.push(cmd.armyId);
  return ids.every((id) => state.armies.find((a) => a.id === id)?.auto !== false);
}

/** Выключает auto у армий, которые ручная команда взяла под управление игрока. */
export function takeOver(state: MatchState, cmd: Command): void {
  const ids = armiesTakenOver(state, cmd);
  for (const a of state.armies) if (ids.includes(a.id)) a.auto = false;
}
