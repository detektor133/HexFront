// Команды отрядов: move, attack, stop, split, merge, bombard.
// GDD: docs/gdd/05-armies.md — «Движение», «Разделение и слияние», «Приказы».
import { MAX_UNITS_PER_HEX } from '../balance.ts';
import { OK, rejected, type Command, type RejectReason, type Validation } from './types.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, intDiv, type Fp } from '../math/int.ts';
import { forecastInState } from '../queries/forecast.ts';
import { planGather } from '../queries/gather.ts';
import { findPath, isHostileHex, ownUnitsAt } from '../queries/unit-path.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import type { Unit, MatchState } from '../state/types.ts';
import { addUnit, removeUnits } from '../state/unit-index.ts';

export type UnitCommand = Extract<
  Command,
  { t: 'move' | 'attack' | 'stop' | 'gather' | 'split' | 'merge' | 'bombard' }
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

/** Наибольшее число промежуточных точек приказа `move`. */
export const MAX_VIA_POINTS = 5;

const validHex = (state: MatchState, hex: HexId): boolean =>
  Number.isInteger(hex) && hex >= 0 && hex < state.hexes.owner.length;

/** Путь по звеньям from → via… → to; null — недостижимое звено. */
export function routePath(
  state: MatchState,
  unit: Unit,
  via: readonly HexId[],
  to: HexId,
  start: HexId = unit.hex,
): HexId[] | null {
  // Слабый враг (победа по прогнозу) не преграда: отряд дойдёт и атакует его сам (meetEnemy).
  const weakEnemy = (hex: HexId): boolean =>
    unit.type !== 'artillery' && forecastInState(state, [unit], hex).outcome === 'victory';
  const path: HexId[] = [];
  let from = start;
  for (const point of [...via, to]) {
    const leg = findPath(state, from, point, unit.type, unit.owner, false, weakEnemy);
    if (!leg) return null;
    path.push(...leg);
    from = point;
  }
  return path;
}

/** Сколько ближайших своих гексов пробует артиллерия, ища место «в упор» к цели. */
const ARTY_STAND_CANDIDATES = 12;

/**
 * Куда идёт отряд по приказу на гекс. Артиллерия не входит на чужую землю: она встаёт на своём
 * гексе, ближайшем к цели (в упор к клетке) и ждёт — огонь ведётся сам; остальные идут на цель.
 */
export function orderDestination(state: MatchState, unit: Unit, to: HexId): HexId {
  if (unit.type !== 'artillery' || state.hexes.owner[to] === unit.owner) return to;
  const { width } = state.map;
  const target = hexFromId(to, width);
  const own: { readonly hex: HexId; readonly d: number }[] = [];
  state.hexes.owner.forEach((o, h) => {
    if (o === unit.owner) own.push({ hex: h, d: distance(hexFromId(h, width), target) });
  });
  own.sort((a, b) => a.d - b.d || a.hex - b.hex);
  for (const { hex } of own.slice(0, ARTY_STAND_CANDIDATES)) {
    if (hex === unit.hex || findPath(state, unit.hex, hex, unit.type, unit.owner)) return hex;
  }
  return to;
}

function validateMove(
  state: MatchState,
  units: readonly Unit[],
  to: HexId,
  via: readonly HexId[] = [],
): Validation {
  if (!validHex(state, to) || !via.every((point) => validHex(state, point))) {
    return rejected('badHex');
  }
  if (via.length > MAX_VIA_POINTS) return rejected('badOrder');
  for (const a of units) {
    const dest = orderDestination(state, a, to);
    if (a.hex === dest && via.length === 0) continue;
    if (ownUnitsAt(state, a.owner, dest) >= MAX_UNITS_PER_HEX && a.hex !== dest)
      return rejected('hexFull');
    if (!routePath(state, a, via, dest)) return rejected('noPath');
  }
  return OK;
}

// Атака = путь до вражеского гекса; последний шаг движение превращает в атаку.
function validateAttack(
  state: MatchState,
  units: readonly Unit[],
  target: HexId,
  via: readonly HexId[] = [],
): Validation {
  if (!Number.isInteger(target) || target < 0 || target >= state.hexes.owner.length) {
    return rejected('badHex');
  }
  // Артиллерия в атаку не идёт, но выбранная вместе с пехотой подходит в упор и встаёт.
  const strikers = units.filter((u) => u.type !== 'artillery');
  if (strikers.some((u) => !isHostileHex(state, u.owner, target))) return rejected('notEnemy');
  return validateMove(state, units, target, via);
}

// Фокус огня: только артиллерия, цель — существующий чужой отряд (или null — автоцель).
function validateBombard(
  state: MatchState,
  unit: Unit | undefined,
  target: number | null,
): Validation {
  if (unit?.type !== 'artillery') return rejected('badOrder');
  if (target === null) return OK;
  const enemy = state.units.find((u) => u.id === target);
  if (!enemy) return rejected('unknownUnit');
  return enemy.owner === unit.owner ? rejected('notEnemy') : OK;
}

function validateSplit(state: MatchState, unit: Unit, soldiers: number): Validation {
  if (!Number.isInteger(soldiers) || soldiers % FP !== 0 || soldiers <= 0) {
    return rejected('invalidAmount');
  }
  if (soldiers >= unit.soldiers) return rejected('invalidAmount');
  if (ownUnitsAt(state, unit.owner, unit.hex) >= MAX_UNITS_PER_HEX) return rejected('hexFull');
  return OK;
}

function validateMerge(units: readonly Unit[]): Validation {
  const [first] = units;
  if (!first || units.length < 2) return rejected('invalidAmount');
  if (units.some((a) => a.hex !== first.hex)) return rejected('notSameHex');
  if (units.some((a) => a.type !== first.type)) return rejected('notSameType');
  if (units.some((a) => a.armyId === null)) return rejected('unitInReserve');
  if (units.some((a) => a.armyId !== first.armyId)) return rejected('notSameArmy');
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
  const ids = cmd.t === 'split' || cmd.t === 'bombard' ? [cmd.unitId] : cmd.unitIds;
  const owned = ownUnits(state, playerId, ids);
  if (!owned.ok) return rejected(owned.reason);
  // Отступающий отряд приказов не принимает (06-combat.md, «Отступление»).
  if (owned.units.some((u) => u.order === 'retreat')) return rejected('retreating');
  // Плывущему отряду приказов нет: он причалит сам (03-cities-buildings.md, «Порты»).
  if (owned.units.some((u) => u.sea)) return rejected('badOrder');
  switch (cmd.t) {
    case 'move':
      return validateMove(state, owned.units, cmd.to, cmd.via);
    case 'attack':
      return validateAttack(state, owned.units, cmd.target, cmd.via);
    case 'bombard':
      return validateBombard(state, owned.units[0], cmd.targetUnitId);
    case 'split':
      if (
        cmd.to !== undefined &&
        !(Number.isInteger(cmd.to) && cmd.to >= 0 && cmd.to < state.hexes.owner.length)
      ) {
        return rejected('badHex');
      }
      return owned.units[0]
        ? validateSplit(state, owned.units[0], cmd.soldiers)
        : rejected('unknownUnit');
    case 'merge':
      return validateMerge(owned.units);
    case 'gather':
      return planGather(state, playerId, owned.units) ? OK : rejected('noPath');
    case 'stop':
      return OK;
  }
}

function stop(unit: Unit): void {
  unit.path = [];
  unit.moveTicks = 0;
  unit.moveTotal = 0;
}

/**
 * Отделяет от отряда soldiers солдат в новый отряд в том же гексе и армии (05-armies.md).
 * @returns новый отряд
 */
export function splitUnit(state: MatchState, unit: Unit, soldiers: Fp): Unit {
  unit.soldiers = (unit.soldiers - soldiers) as Fp;
  // Id растут монотонно, поэтому push сохраняет сортировку отрядов по id.
  const part: Unit = {
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
    sea: false,
    target: -1,
    inBattle: false,
    focus: -1,
    fireTarget: -1,
    slot: -1,
    gather: -1,
  };
  addUnit(state, part);
  state.nextId += 1;
  return part;
}

/** Сливает однотипные отряды в одном гексе; остаётся отряд с наименьшим id. */
export function mergeUnits(state: MatchState, units: readonly Unit[]): void {
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
  removeUnits(state, rest);
}

/** Применяет команду отряда. Вызывается только после успешной проверки. */
export function executeUnitCommand(state: MatchState, playerId: number, cmd: UnitCommand): void {
  const ids = cmd.t === 'split' || cmd.t === 'bombard' ? [cmd.unitId] : cmd.unitIds;
  const owned = ownUnits(state, playerId, ids);
  if (!owned.ok) return;
  switch (cmd.t) {
    case 'move':
    case 'attack':
      for (const a of owned.units) {
        const dest = orderDestination(state, a, cmd.t === 'move' ? cmd.to : cmd.target);
        const path = routePath(state, a, cmd.via ?? [], dest) ?? [];
        // Приказ игрока выполняется сразу: начатый шаг прерывается. Исключение — тот же ближайший
        // шаг: переход продолжается с накопленным прогрессом (05-armies.md).
        const sameStep = a.moveTotal > 0 && path[0] !== undefined && path[0] === a.path[0];
        if (!sameStep) stop(a);
        // Ручной приказ снимает отряд с места в плане армии; освободившись, он вернётся в план.
        a.slot = -1;
        a.gather = -1;
        a.path = path;
        a.order = path.length > 0 ? 'move' : 'idle';
      }
      return;
    case 'split':
      if (owned.units[0]) {
        const part = splitUnit(state, owned.units[0], cmd.soldiers);
        // Вытянули из фишки в другой гекс — отделённая часть сразу идёт туда.
        const path =
          cmd.to === undefined || cmd.to === part.hex
            ? null
            : findPath(state, part.hex, cmd.to, part.type, part.owner);
        if (path && path.length > 0) {
          part.path = path;
          part.order = 'move';
          // Вытянутая вручную часть свободна от плана армии (решение владельца 2026-11-03).
          if (state.plans.some((p) => p.armyId === part.armyId)) part.slot = SLOT_DETACHED;
        }
      }
      return;
    case 'bombard':
      if (owned.units[0]) owned.units[0].focus = cmd.targetUnitId ?? -1;
      return;
    case 'merge':
      mergeUnits(state, owned.units);
      return;
    case 'gather': {
      const targets = planGather(state, playerId, owned.units);
      if (!targets) return;
      for (const unit of owned.units) {
        const to = targets.get(unit.id) ?? unit.hex;
        stop(unit);
        unit.slot = -1;
        unit.target = -1;
        unit.gather = to;
        unit.path = findPath(state, unit.hex, to, unit.type, unit.owner) ?? [];
        unit.order = unit.path.length > 0 ? 'move' : 'idle';
      }
      return;
    }
    case 'stop':
      for (const unit of owned.units) {
        stop(unit);
        unit.gather = -1;
        unit.slot = -1;
        unit.target = -1;
        if (unit.order === 'move' || unit.order === 'attack') unit.order = 'idle';
      }
      return;
  }
}
