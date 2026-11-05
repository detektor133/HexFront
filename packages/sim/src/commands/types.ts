// Команды игроков и ботов — единственный способ изменить состояние.
// Архитектура: docs/architecture/sim-core.md — «Команды».
import type { UnitType } from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';
import type { TreatyKind } from '../state/types.ts';

export type Command =
  | { readonly t: 'setTax'; readonly rate: Fp }
  | {
      readonly t: 'move';
      readonly unitIds: readonly number[];
      readonly to: HexId;
      /** Промежуточные точки маршрута по порядку, не больше MAX_VIA_POINTS (CR-012). */
      readonly via?: readonly HexId[];
    }
  | {
      readonly t: 'attack';
      readonly unitIds: readonly number[];
      readonly target: HexId;
      /** Промежуточные точки перед атакой — цепочка приказов Shift+ПКМ, не больше MAX_VIA_POINTS. */
      readonly via?: readonly HexId[];
    }
  | {
      readonly t: 'assignFront';
      readonly armyId: number;
      /** Грани своей границы (EdgeId); между ними фронт достраивается по граням (CR-004). */
      readonly edges: readonly number[];
    }
  | { readonly t: 'setDefenseLine'; readonly armyId: number; readonly points: readonly HexId[] }
  | { readonly t: 'clearPlan'; readonly armyId: number; readonly edges?: readonly number[] }
  | {
      readonly t: 'setOffensiveLine';
      readonly armyId: number;
      readonly edges: readonly number[];
      /** Несколько отдельных линий наступления; нет — `edges` одна линия. */
      readonly lines?: readonly (readonly number[])[];
    }
  | { readonly t: 'startOffensive'; readonly armyId: number }
  | { readonly t: 'stopOffensive'; readonly armyId: number }
  | { readonly t: 'clearOffensive'; readonly armyId: number }
  /** soldiers — fixed-point, целое число солдат. */
  | {
      readonly t: 'split';
      readonly unitId: number;
      readonly soldiers: Fp;
      /** Куда сразу отправить отделённую часть (вытянули из фишки, CR-005). */
      readonly to?: HexId;
    }
  | { readonly t: 'merge'; readonly unitIds: readonly number[] }
  /** Отмена приказа движения и атаки; отряд остаётся в гексе, где стоит. */
  | { readonly t: 'stop'; readonly unitIds: readonly number[] }
  /** Сбор: отряды идут в область, найденную симуляцией, и сливаются по прибытии (CR-010). */
  | { readonly t: 'gather'; readonly unitIds: readonly number[] }
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
  | { readonly t: 'rebuildSupply'; readonly hex: HexId }
  | { readonly t: 'createArmy'; readonly name: string }
  | { readonly t: 'setAutoReinforce'; readonly on: boolean }
  /** Значок «А» на карточке армии (CR-006). */
  | { readonly t: 'setArmyAuto'; readonly armyId: number; readonly on: boolean }
  /** Настройка «Автокомандование» для новых армий (CR-006). */
  | { readonly t: 'setAutoCommand'; readonly on: boolean }
  /** Дипломатия (CR-007): объявить войну; предложить пакт/союз; ответить; разорвать договор. */
  | { readonly t: 'declareWar'; readonly target: number }
  | { readonly t: 'proposeTreaty'; readonly target: number; readonly kind: TreatyKind }
  | { readonly t: 'answerTreaty'; readonly from: number; readonly accept: boolean }
  | { readonly t: 'breakTreaty'; readonly target: number }
  /**
   * Наступление с заказом числа солдат: армия, фронт, линия и старт одной командой. Цель — id игрока
   * (нужна война) или -1 (ничья земля у гекса hex).
   */
  | {
      readonly t: 'launchOffensive';
      readonly target: number;
      readonly soldiers: number;
      readonly hex?: number;
    }
  /** Держать границу: армия, фронт и заказ числа солдат без наступления; можно и в мире. */
  | {
      readonly t: 'holdBorder';
      readonly target: number;
      readonly soldiers: number;
      readonly hex?: number;
    }
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
  'depotTooClose',
  'unknownDepot',
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
  'notSameArmy',
  'unitInReserve',
  'badOrder',
  'unknownArmy',
  'notOwnArmy',
  'badName',
  'badValue',
  /** Команда commander для армии, у которой auto уже выключен (CR-006). */
  'notAuto',
  'noFront',
  'tooManyOffensives',
  'noOffensive',
  'notEnemy',
  'retreating',
  'inBattle',
  /** Дипломатия выключена или игрок не найден (CR-007). */
  'badPlayer',
  'sameRelation',
  'noOffer',
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

export type Validation =
  { readonly ok: true } | { readonly ok: false; readonly reason: RejectReason };

/** Команда с автором, как она приходит в step. */
export interface PlayerCommand {
  readonly playerId: number;
  readonly cmd: Command;
  /** 'auto' — команду отдал commander: не выключает auto у армии (CR-006). */
  readonly source?: 'auto';
}

export const OK: Validation = { ok: true };

/**
 * Отказ с причиной.
 * @returns результат проверки «отклонено»
 */
export function rejected(reason: RejectReason): Validation {
  return { ok: false, reason };
}
