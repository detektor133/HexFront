// Команды армий — групп отрядов (CR-001): createArmy, renameArmy, disbandArmy, assignUnits;
// автокомандование — setArmyAuto, setAutoCommand (CR-006). GDD: docs/gdd/05-armies.md — «Модель».
import { removePlan } from './plan.ts';
import { OK, rejected, type Command, type RejectReason, type Validation } from './types.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { trimAutoFront } from '../state/front.ts';
import type { Army, ArmyMix, MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

export type ArmyCommand = Extract<
  Command,
  {
    t:
      | 'createArmy'
      | 'renameArmy'
      | 'disbandArmy'
      | 'splitArmy'
      | 'setArmyLimit'
      | 'assignUnits'
      | 'setAutoReinforce'
      | 'setArmyAuto'
      | 'setAutoCommand';
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

/** Состав допустим, если его нет или танки и артиллерия — целые неотрицательные в пределах лимита. */
export function validMix(mix: ArmyMix | undefined, soldiers: number): boolean {
  if (mix === undefined) return true;
  const { armor, artillery } = mix;
  return (
    Number.isInteger(armor) &&
    Number.isInteger(artillery) &&
    armor >= 0 &&
    artillery >= 0 &&
    armor + artillery <= soldiers
  );
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
  if (cmd.t === 'setAutoReinforce' || cmd.t === 'setAutoCommand') {
    return typeof cmd.on === 'boolean' ? OK : rejected('badValue');
  }
  if (cmd.t === 'setArmyAuto' && typeof cmd.on !== 'boolean') return rejected('badValue');
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
  if (cmd.t === 'setArmyLimit') {
    if (!(Number.isInteger(cmd.soldiers) && cmd.soldiers >= 0)) return rejected('badValue');
    if (!validMix(cmd.mix, cmd.soldiers)) return rejected('badValue');
  }
  if (cmd.t === 'splitArmy' && allUnits(state).filter((u) => u.armyId === cmd.armyId).length < 2) {
    return rejected('tooFewUnits');
  }
  return OK;
}

/**
 * Армия без отрядов, без направления и без заказа набора никому не нужна (стартовая «1-я армия»
 * после того, как её отряды ушли на направление): убирается вместе с планом.
 */
export function dropEmptyArmies(state: MatchState, armyIds: ReadonlySet<number>): void {
  for (const id of armyIds) {
    const army = state.armies.find((a) => a.id === id);
    if (!army || army.dir !== undefined || army.wanted !== undefined) continue;
    if (state.units.some((u) => u.armyId === id)) continue;
    if (state.recruits.some((r) => r.armyId === id)) continue;
    removePlan(state, id);
    const rest = state.armies.filter((a) => a.id !== id);
    state.armies.splice(0, state.armies.length, ...rest);
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
        auto: player.autoCommand,
      });
      state.nextId += 1;
      return;
    }
    case 'renameArmy': {
      const army = state.armies.find((a) => a.id === cmd.armyId);
      if (army) army.name = cmd.name;
      return;
    }
    case 'setArmyLimit': {
      // Лимит есть у любой армии: ИИ добирает её до числа из резерва и закупкой; 0 — лимит снят.
      const army = state.armies.find((a) => a.id === cmd.armyId);
      if (!army) return;
      if (cmd.soldiers === 0) delete army.wanted;
      else army.wanted = cmd.soldiers;
      if (cmd.mix === undefined || cmd.soldiers === 0) delete army.mix;
      else army.mix = cmd.mix;
      return;
    }
    case 'disbandArmy': {
      removePlan(state, cmd.armyId);
      for (const u of state.units) if (u.armyId === cmd.armyId) u.armyId = null;
      const rest = state.armies.filter((a) => a.id !== cmd.armyId);
      state.armies.splice(0, state.armies.length, ...rest);
      return;
    }
    case 'splitArmy': {
      const source = state.armies.find((a) => a.id === cmd.armyId);
      const player = state.players[playerId];
      if (!source || !player) return;
      // Крупные отряды по очереди уходят в более лёгкую половину: суммы почти равны.
      const units = allUnits(state)
        .filter((u) => u.armyId === cmd.armyId)
        .sort((x, y) => y.soldiers - x.soldiers || x.id - y.id);
      player.armiesCreated += 1;
      const half = {
        id: state.nextId,
        owner: playerId,
        number: player.armiesCreated,
        name: '',
        auto: source.auto,
      };
      state.nextId += 1;
      state.armies.push(half);
      let kept = 0;
      let moved = 0;
      for (const u of units) {
        if (kept <= moved) kept += u.soldiers;
        else {
          moved += u.soldiers;
          u.armyId = half.id;
          u.slot = -1;
        }
      }
      return;
    }
    case 'assignUnits':
      // Передача возвращает отряд под план новой армии (снимает ручную «свободу», SLOT_DETACHED).
      for (const u of state.units) {
        if (!cmd.unitIds.includes(u.id)) continue;
        u.armyId = cmd.armyId;
        if (u.slot === SLOT_DETACHED) u.slot = -1;
      }
      return;
    case 'setAutoReinforce': {
      const player = state.players[playerId];
      if (player) player.autoReinforce = cmd.on;
      return;
    }
    case 'setAutoCommand': {
      const player = state.players[playerId];
      if (player) player.autoCommand = cmd.on;
      return;
    }
    case 'setArmyAuto': {
      const army = state.armies.find((a) => a.id === cmd.armyId);
      if (army) army.auto = cmd.on;
      trimAutoFront(state, cmd.armyId);
      return;
    }
  }
}
