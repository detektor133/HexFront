// Команды игроков и ботов — единственный способ изменить состояние.
// Архитектура: docs/architecture/sim-core.md — «Команды».
import type { UnitType } from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';

export type Command =
  | { readonly t: 'setTax'; readonly rate: Fp }
  | { readonly t: 'move'; readonly unitIds: readonly number[]; readonly to: HexId }
  | { readonly t: 'attack'; readonly unitIds: readonly number[]; readonly target: HexId }
  | {
      readonly t: 'setOrder';
      readonly unitIds: readonly number[];
      readonly order: 'idle' | 'hold' | 'expand';
    }
  | {
      readonly t: 'assignFront';
      readonly armyId: number;
      /** Точки на своей границе; между ними фронт достраивается по гексам границы (CR-003). */
      readonly points: readonly HexId[];
    }
  | { readonly t: 'setDefenseLine'; readonly armyId: number; readonly points: readonly HexId[] }
  | { readonly t: 'clearPlan'; readonly armyId: number }
  | { readonly t: 'setOffensiveLine'; readonly armyId: number; readonly points: readonly HexId[] }
  | { readonly t: 'stopOffensive'; readonly armyId: number }
  /** soldiers — fixed-point, целое число солдат. */
  | { readonly t: 'split'; readonly unitId: number; readonly soldiers: Fp }
  | { readonly t: 'merge'; readonly unitIds: readonly number[] }
  | { readonly t: 'bombard'; readonly unitId: number; readonly targetUnitId: number | null }
  | {
      readonly t: 'recruit';
      readonly cityId: number;
      readonly type: UnitType;
      /** fixed-point солдат, кратно RECRUIT_STEP. */
      readonly soldiers: Fp;
    }
  | { readonly t: 'foundCity'; readonly hex: HexId }
  | { readonly t: 'upgradeCity'; readonly cityId: number }
  | { readonly t: 'improve'; readonly hex: HexId }
  | { readonly t: 'build'; readonly hex: HexId; readonly kind: 'fort' | 'depot' }
  | { readonly t: 'rebuildSupply'; readonly cityId: number }
  | {
      readonly t: 'armyOrder';
      readonly armyId: number;
      readonly order: 'idle' | 'hold' | 'expand';
    }
  | { readonly t: 'createArmy'; readonly name: string }
  | { readonly t: 'setAutoReinforce'; readonly on: boolean }
  | { readonly t: 'renameArmy'; readonly armyId: number; readonly name: string }
  | { readonly t: 'disbandArmy'; readonly armyId: number }
  | {
      readonly t: 'assignUnits';
      readonly unitIds: readonly number[];
      /** null — вернуть в резерв. */
      readonly armyId: number | null;
    };

/** Причины отклонения команды; уходят клиенту, тексты — в i18n клиента. */
export const REJECT_REASONS = [
  'notImplemented',
  'unknownPlayer',
  'playerEliminated',
  'invalidTaxRate',
  'badHex',
  'notOwnHex',
  'hexBusy',
  'isCity',
  'cityTooClose',
  'popTooLow',
  'notEnoughGold',
  'unknownCity',
  'notOwnCity',
  'maxLevel',
  'buildingExists',
  'fortInCity',
  'depotNeedsRoad',
  'notIsolated',
  'noPath',
  'alreadyBuilding',
  'bankrupt',
  'badUnitType',
  'invalidAmount',
  'queueBusy',
  'unitLimit',
  'notEnoughPeople',
  'unknownUnit',
  'notOwnUnit',
  'hexFull',
  'notSameHex',
  'notSameType',
  'badOrder',
  'unknownArmy',
  'notOwnArmy',
  'badName',
  'badValue',
  'noFront',
  'tooManyOffensives',
  'notEnemy',
  'retreating',
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

export type Validation =
  { readonly ok: true } | { readonly ok: false; readonly reason: RejectReason };

/** Команда с автором, как она приходит в step. */
export interface PlayerCommand {
  readonly playerId: number;
  readonly cmd: Command;
}

export const OK: Validation = { ok: true };

/**
 * Отказ с причиной.
 * @returns результат проверки «отклонено»
 */
export function rejected(reason: RejectReason): Validation {
  return { ok: false, reason };
}
