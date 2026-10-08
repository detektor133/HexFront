// Отряды и армии в снимке игрока. Туман войны — этап 04: пока видны все отряды, но скрытое
// у чужих (снабжение, армия, путь) не передаётся (08-match.md, «Туман войны»).
import type { UnitType } from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';
import type { MatchState, UnitOrder } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';
import { isStarving } from '../systems/attrition.ts';

/** Отряд в снимке; поля null/пусто у чужих отрядов. */
export interface UnitView {
  readonly id: number;
  readonly owner: number;
  readonly type: UnitType;
  readonly soldiers: Fp;
  readonly org: Fp;
  readonly hex: HexId;
  readonly order: UnitOrder;
  readonly inBattle?: boolean | null;
  /** Цель атаки или -1. */
  readonly target: HexId;
  /** Прогресс перехода для интерполяции, тики. */
  readonly moveTicks: number;
  readonly moveTotal: number;
  /** Снабжённость — только своих отрядов; у чужих неизвестна. */
  readonly supplyLevel: Fp | null;
  readonly encircled: boolean | null;
  /** Свой отряд прямо сейчас теряет солдат от истощения; у чужих неизвестно. */
  readonly starving: boolean | null;
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
  /** Автокомандование (CR-006). */
  readonly auto: boolean;
}

/** Отряды для снимка игрока playerId. */
export function unitViews(state: MatchState, playerId: number, visible?: Uint8Array): UnitView[] {
  return allUnits(state)
    .filter((u) => u.owner === playerId || (visible?.[u.hex] ?? 1) === 1)
    .map((u) => {
      const mine = u.owner === playerId;
      return {
        id: u.id,
        owner: u.owner,
        type: u.type,
        soldiers: u.soldiers,
        org: u.org,
        hex: u.hex,
        order: u.order,
        inBattle: mine ? u.inBattle : null,
        target: u.target,
        moveTicks: u.moveTicks,
        moveTotal: u.moveTotal,
        supplyLevel: mine ? u.supplyLevel : null,
        encircled: mine ? u.encircled : null,
        starving: mine ? isStarving(u) : null,
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
    .map((a) => ({ id: a.id, number: a.number, name: a.name, auto: a.auto }));
}
