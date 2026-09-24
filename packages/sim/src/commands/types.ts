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
  | { readonly t: 'split'; readonly armyId: number; readonly soldiers: number }
  | { readonly t: 'merge'; readonly armyIds: readonly number[] }
  | { readonly t: 'bombard'; readonly armyId: number; readonly targetArmyId: number | null }
  | {
      readonly t: 'recruit';
      readonly cityId: number;
      readonly type: UnitType;
      readonly soldiers: number;
    }
  | { readonly t: 'foundCity'; readonly hex: HexId }
  | { readonly t: 'upgradeCity'; readonly cityId: number }
  | { readonly t: 'improve'; readonly hex: HexId }
  | { readonly t: 'build'; readonly hex: HexId; readonly kind: 'fort' | 'depot' }
  | { readonly t: 'rebuildSupply'; readonly cityId: number };

/** Причина отклонения команды; уходит клиенту. */
export type RejectReason =
  'notImplemented' | 'unknownPlayer' | 'playerEliminated' | 'invalidTaxRate';

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
