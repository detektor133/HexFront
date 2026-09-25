// Команды отрядов: move, setOrder, split, merge.
// GDD: docs/gdd/05-armies.md — «Движение», «Разделение и слияние», «Приказы».
import { MAX_UNITS_PER_HEX } from '../balance.ts';
import { unitLimit } from './recruit.ts';
import { OK, rejected, type Command, type RejectReason, type Validation } from './types.ts';
import type { HexId } from '../math/hex.ts';
import { FP, intDiv, type Fp } from '../math/int.ts';
import { findPath, isHostileHex, ownUnitsAt } from '../queries/unit-path.ts';
import type { Unit, MatchState } from '../state/types.ts';

export type UnitCommand = Extract<
  Command,
  { t: 'move' | 'attack' | 'setOrder' | 'split' | 'merge' }
>;

type Owned =
  | { readonly ok: true; readonly units: Unit[] }
  | { readonly ok: false; readonly reason: RejectReason };

// Все id различны, существуют и принадлежат игроку; порядок — как в команде.
function ownUnits(state: MatchState, playerId: number, ids: readonly number[]): Owned {
  if (ids.length === 0 || new Set(ids).size !== ids.length)
    return { ok: false, reason: 'unknownUnit' };
  const units: Unit[] = [];
  for (const id of ids) {
    const unit = state.units.find((a) => a.id === id);
    if (!unit) return { ok: false, reason: 'unknownUnit' };
    if (unit.owner !== playerId) return { ok: false, reason: 'notOwnUnit' };
    units.push(unit);
  }
  return { ok: true, units };
}

function validateMove(state: MatchState, units: readonly Unit[], to: HexId): Validation {
  if (!Number.isInteger(to) || to < 0 || to >= state.hexes.owner.length) return rejected('badHex');
  for (const a of units) {
    if (a.hex === to) continue;
    if (ownUnitsAt(state, a.owner, to) >= MAX_UNITS_PER_HEX) return rejected('hexFull');
    if (!findPath(state, a.hex, to, a.type, a.owner)) return rejected('noPath');
  }
  return OK;
}

// Атака = путь до вражеского гекса; последний шаг движение превращает в атаку.
function validateAttack(state: MatchState, units: readonly Unit[], target: HexId): Validation {
  if (!Number.isInteger(target) || target < 0 || target >= state.hexes.owner.length) {
    return rejected('badHex');
  }
  if (units.some((u) => u.type === 'artillery')) return rejected('badOrder');
  if (units.some((u) => !isHostileHex(state, u.owner, target))) return rejected('notEnemy');
  return validateMove(state, units, target);
}

function validateSplit(state: MatchState, unit: Unit, soldiers: number): Validation {
  if (!Number.isInteger(soldiers) || soldiers % FP !== 0 || soldiers <= 0) {
    return rejected('invalidAmount');
  }
  if (soldiers >= unit.soldiers) return rejected('invalidAmount');
  if (ownUnitsAt(state, unit.owner, unit.hex) >= MAX_UNITS_PER_HEX) return rejected('hexFull');
  const used =
    state.units.filter((a) => a.owner === unit.owner).length +
    state.recruits.filter((r) => r.owner === unit.owner).length;
  return used >= unitLimit(state, unit.owner) ? rejected('unitLimit') : OK;
}

function validateMerge(units: readonly Unit[]): Validation {
  const [first] = units;
  if (!first || units.length < 2) return rejected('invalidAmount');
  if (units.some((a) => a.hex !== first.hex)) return rejected('notSameHex');
  if (units.some((a) => a.type !== first.type)) return rejected('notSameType');
  return OK;
}

/**
 * Проверяет команду отряда без изменения состояния.
 * @returns OK или отказ с причиной
 */
export function validateUnitCommand(
  state: MatchState,
  playerId: number,
  cmd: UnitCommand,
): Validation {
  const ids = cmd.t === 'split' ? [cmd.unitId] : cmd.unitIds;
  const owned = ownUnits(state, playerId, ids);
  if (!owned.ok) return rejected(owned.reason);
  // Отступающий отряд приказов не принимает (06-combat.md, «Отступление»).
  if (owned.units.some((u) => u.order === 'retreat')) return rejected('retreating');
  switch (cmd.t) {
    case 'move':
      return validateMove(state, owned.units, cmd.to);
    case 'attack':
      return validateAttack(state, owned.units, cmd.target);
    case 'setOrder':
      // Артиллерия не захватывает гексы, поэтому экспансия ей недоступна.
      return cmd.order === 'expand' && owned.units.some((a) => a.type === 'artillery')
        ? rejected('badOrder')
        : OK;
    case 'split':
      return owned.units[0]
        ? validateSplit(state, owned.units[0], cmd.soldiers)
        : rejected('unknownUnit');
    case 'merge':
      return validateMerge(owned.units);
  }
}

function stop(unit: Unit): void {
  unit.path = [];
  unit.moveTicks = 0;
  unit.moveTotal = 0;
}

function executeSplit(state: MatchState, unit: Unit, soldiers: Fp): void {
  unit.soldiers = (unit.soldiers - soldiers) as Fp;
  // Id растут монотонно, поэтому push сохраняет сортировку отрядов по id.
  state.units.push({
    id: state.nextId,
    owner: unit.owner,
    type: unit.type,
    soldiers,
    org: unit.org,
    hex: unit.hex,
    order: 'idle',
    supplyLevel: unit.supplyLevel,
    path: [],
    moveTicks: 0,
    moveTotal: 0,
    armyId: unit.armyId,
    lowSupplyTicks: unit.lowSupplyTicks,
    encircled: unit.encircled,
    target: -1,
    inBattle: false,
  });
  state.nextId += 1;
}

// Остаётся отряд с наименьшим id; org — средневзвешенная по солдатам.
function executeMerge(state: MatchState, units: readonly Unit[]): void {
  const sorted = [...units].sort((a, b) => a.id - b.id);
  const [kept, ...rest] = sorted;
  if (!kept) return;
  let soldiers = 0;
  let orgWeighted = 0;
  for (const a of sorted) {
    soldiers += a.soldiers;
    orgWeighted += a.org * a.soldiers;
  }
  kept.soldiers = soldiers as Fp;
  kept.org = intDiv(orgWeighted, soldiers) as Fp;
  kept.order = 'idle';
  stop(kept);
  const removed = new Set(rest.map((a) => a.id));
  const remaining = state.units.filter((a) => !removed.has(a.id));
  state.units.splice(0, state.units.length, ...remaining);
}

/** Применяет команду отряда. Вызывается только после успешной проверки. */
export function executeUnitCommand(state: MatchState, playerId: number, cmd: UnitCommand): void {
  const ids = cmd.t === 'split' ? [cmd.unitId] : cmd.unitIds;
  const owned = ownUnits(state, playerId, ids);
  if (!owned.ok) return;
  switch (cmd.t) {
    case 'move':
    case 'attack':
      for (const a of owned.units) {
        const path =
          findPath(state, a.hex, cmd.t === 'move' ? cmd.to : cmd.target, a.type, a.owner) ?? [];
        stop(a);
        a.path = path;
        a.order = path.length > 0 ? 'move' : 'idle';
      }
      return;
    case 'setOrder':
      for (const a of owned.units) {
        stop(a);
        a.order = cmd.order;
      }
      return;
    case 'split':
      if (owned.units[0]) executeSplit(state, owned.units[0], cmd.soldiers);
      return;
    case 'merge':
      executeMerge(state, owned.units);
      return;
  }
}
