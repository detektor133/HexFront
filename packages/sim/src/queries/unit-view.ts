// Отряды и армии в снимке игрока. Туман войны — этап 04: пока видны все отряды, но скрытое
// у чужих (снабжение, армия, путь) не передаётся (08-match.md, «Туман войны»).
import type { UnitType } from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';
import type { MatchState, UnitOrder } from '../state/types.ts';

/** Отряд в снимке; поля null/пусто у чужих отрядов. */
export interface UnitView {
  readonly id: number;
  readonly owner: number;
  readonly type: UnitType;
  readonly soldiers: Fp;
  readonly org: Fp;
  readonly hex: HexId;
  readonly order: UnitOrder;
  /** Цель атаки или -1. */
  readonly target: HexId;
  /** Прогресс перехода для интерполяции, тики. */
  readonly moveTicks: number;
  readonly moveTotal: number;
  /** Снабжённость — только своих отрядов; у чужих неизвестна. */
  readonly supplyLevel: Fp | null;
  readonly encircled: boolean | null;
  readonly armyId: number | null;
  readonly path: readonly HexId[];
  /** Своя артиллерия: по кому бьёт сейчас, иначе -1. */
  readonly fireTarget: number;
}

/** Своя армия в снимке. */
export interface ArmyView {
  readonly id: number;
  readonly number: number;
  readonly name: string;
}

/** Отряды для снимка игрока playerId. */
export function unitViews(state: MatchState, playerId: number): UnitView[] {
  return state.units.map((u) => {
    const mine = u.owner === playerId;
    return {
      id: u.id,
      owner: u.owner,
      type: u.type,
      soldiers: u.soldiers,
      org: u.org,
      hex: u.hex,
      order: u.order,
      target: u.target,
      moveTicks: u.moveTicks,
      moveTotal: u.moveTotal,
      supplyLevel: mine ? u.supplyLevel : null,
      encircled: mine ? u.encircled : null,
      armyId: mine ? u.armyId : null,
      path: mine ? [...u.path] : [],
      fireTarget: mine ? u.fireTarget : -1,
    };
  });
}

/** Свои армии для снимка. */
export function armyViews(state: MatchState, playerId: number): ArmyView[] {
  return state.armies
    .filter((a) => a.owner === playerId)
    .map((a) => ({ id: a.id, number: a.number, name: a.name }));
}
