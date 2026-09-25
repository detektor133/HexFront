// Команды игроков и ботов — единственный способ изменить состояние.
// Архитектура: docs/architecture/sim-core.md — «Команды».
import type { UnitType } from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';

export type Command =
  | { readonly t: 'setTax'; readonly rate: Fp }
  | { readonly t: 'move'; readonly armyIds: readonly number[]; readonly to: HexId }
  | { readonly t: 'attack'; readonly armyIds: readonly number[]; readonly target: HexId }
  | {
      readonly t: 'setOrder';
      readonly armyIds: readonly number[];
      readonly order: 'idle' | 'hold' | 'expand';
    }
  | { readonly t: 'assignFront'; readonly armyIds: readonly number[]; readonly enemyId: number }
  | { readonly t: 'arrow'; readonly points: readonly HexId[] }
  | { readonly t: 'arrowStop'; readonly arrowId: number }
  /** soldiers — fixed-point, целое число солдат. */
  | { readonly t: 'split'; readonly armyId: number; readonly soldiers: Fp }
  | { readonly t: 'merge'; readonly armyIds: readonly number[] }
  | { readonly t: 'bombard'; readonly armyId: number; readonly targetArmyId: number | null }
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
  | { readonly t: 'rebuildSupply'; readonly cityId: number };

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
  'armyLimit',
  'notEnoughPeople',
  'unknownArmy',
  'notOwnArmy',
  'hexFull',
  'notSameHex',
  'notSameType',
  'badOrder',
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
