// Команды армий — групп отрядов (CR-001): createArmy, renameArmy, disbandArmy, assignUnits,
// armyOrder. GDD: docs/gdd/05-armies.md — «Модель», «Разделение и слияние», «Приказы».
import { OK, rejected, type Command, type RejectReason, type Validation } from './types.ts';
import type { Army, MatchState, Unit } from '../state/types.ts';

export type ArmyCommand = Extract<
  Command,
  {
    t:
      | 'createArmy'
      | 'renameArmy'
      | 'disbandArmy'
      | 'assignUnits'
      | 'armyOrder'
      | 'setAutoReinforce';
  }
>;

/** Предел длины имени армии, символов: техническое ограничение протокола и интерфейса. */
export const ARMY_NAME_MAX = 32;

type Found<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: RejectReason };

function ownArmy(state: MatchState, playerId: number, armyId: number): Found<Army> {
  const army = state.armies.find((a) => a.id === armyId);
  if (!army) return { ok: false, reason: 'unknownArmy' };
  if (army.owner !== playerId) return { ok: false, reason: 'notOwnArmy' };
  return { ok: true, value: army };
}

function ownUnitList(state: MatchState, playerId: number, ids: readonly number[]): Found<Unit[]> {
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    return { ok: false, reason: 'unknownUnit' };
  }
  const units: Unit[] = [];
  for (const id of ids) {
    const unit = state.units.find((u) => u.id === id);
    if (!unit) return { ok: false, reason: 'unknownUnit' };
    if (unit.owner !== playerId) return { ok: false, reason: 'notOwnUnit' };
    units.push(unit);
  }
  return { ok: true, value: units };
}

const validName = (name: unknown): boolean =>
  typeof name === 'string' && name.length <= ARMY_NAME_MAX;

/**
 * Проверяет команду армии без изменения состояния.
 * @returns OK или отказ с причиной
 */
export function validateArmyCommand(
  state: MatchState,
  playerId: number,
  cmd: ArmyCommand,
): Validation {
  if (cmd.t === 'createArmy') return validName(cmd.name) ? OK : rejected('badName');
  if (cmd.t === 'setAutoReinforce') return typeof cmd.on === 'boolean' ? OK : rejected('badValue');
  if (cmd.t === 'assignUnits') {
    const units = ownUnitList(state, playerId, cmd.unitIds);
    if (!units.ok) return rejected(units.reason);
    if (cmd.armyId === null) return OK;
    const army = ownArmy(state, playerId, cmd.armyId);
    return army.ok ? OK : rejected(army.reason);
  }
  const army = ownArmy(state, playerId, cmd.armyId);
  if (!army.ok) return rejected(army.reason);
  if (cmd.t === 'renameArmy' && !validName(cmd.name)) return rejected('badName');
  return OK;
}

// Приказ армии раздаётся её отрядам; экспансия недоступна артиллерии — та встаёт в idle.
function orderArmy(state: MatchState, armyId: number, order: Unit['order']): void {
  for (const u of state.units) {
    if (u.armyId !== armyId) continue;
    u.path = [];
    u.moveTicks = 0;
    u.moveTotal = 0;
    u.order = order === 'expand' && u.type === 'artillery' ? 'idle' : order;
  }
}

/** Применяет команду армии. Вызывается только после успешной проверки. */
export function executeArmyCommand(state: MatchState, playerId: number, cmd: ArmyCommand): void {
  switch (cmd.t) {
    case 'createArmy': {
      const player = state.players[playerId];
      if (!player) return;
      player.armiesCreated += 1;
      // Id растут монотонно, поэтому push сохраняет сортировку армий по id.
      state.armies.push({
        id: state.nextId,
        owner: playerId,
        number: player.armiesCreated,
        name: cmd.name,
      });
      state.nextId += 1;
      return;
    }
    case 'renameArmy': {
      const army = state.armies.find((a) => a.id === cmd.armyId);
      if (army) army.name = cmd.name;
      return;
    }
    case 'disbandArmy': {
      for (const u of state.units) if (u.armyId === cmd.armyId) u.armyId = null;
      const rest = state.armies.filter((a) => a.id !== cmd.armyId);
      state.armies.splice(0, state.armies.length, ...rest);
      return;
    }
    case 'assignUnits':
      for (const u of state.units) if (cmd.unitIds.includes(u.id)) u.armyId = cmd.armyId;
      return;
    case 'armyOrder':
      orderArmy(state, cmd.armyId, cmd.order);
      return;
    case 'setAutoReinforce': {
      const player = state.players[playerId];
      if (player) player.autoReinforce = cmd.on;
      return;
    }
  }
}
