// Состояние матча. Архитектура: docs/architecture/sim-core.md — «Состояние».
// Поля боёв, сетей, фронтов и строек добавляются в этапах, где появляются их системы.
import type { UnitType } from '../balance.ts';
import type { MapStatic } from '../map/types.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';

/** Владелец гекса или города: id игрока либо NEUTRAL. */
export const NEUTRAL = -1;

/** Коды постройки гекса в hexes.building; 0 — нет постройки. */
export const BUILDING = { none: 0, fort: 1, depot: 2 } as const;

/** Изменяемые данные гексов — структура массивов по HexId (ADR-0006). */
export interface HexState {
  /** id игрока или NEUTRAL. */
  readonly owner: Int16Array;
  /** Население, fixed-point людей. */
  readonly pop: Int32Array;
  /** Уровень благоустройства 0–3. */
  readonly improvement: Uint8Array;
  /** Код постройки, 0 — нет. */
  readonly building: Uint8Array;
  /** 1 — на гексе дорога. */
  readonly road: Uint8Array;
}

export interface City {
  readonly id: number;
  readonly hex: HexId;
  owner: number;
  level: number;
  /** Название с карты; у столиц пустое — имя выбирает интерфейс. */
  readonly name: string;
  /** Гарнизон нейтрального города, fixed-point солдат. */
  garrison: Fp;
}

export type PlayerStatus = 'alive' | 'eliminated';

export interface Player {
  readonly id: number;
  /** fixed-point золота. */
  gold: Fp;
  /** Доля 0..0,4 в fixed-point. */
  taxTarget: Fp;
  taxEffective: Fp;
  capitalCityId: number;
  status: PlayerStatus;
  /** Сколько городов игрок основал за матч (N в цене основания), включая начатые стройки. */
  citiesFounded: number;
}

export type ConstructionKind = 'foundCity' | 'upgradeCity' | 'improve' | 'fort' | 'depot' | 'road';

/** Стройка на гексе; одна на гекс. Прогресс — в тиках. */
export interface Construction {
  readonly id: number;
  readonly owner: number;
  readonly hex: HexId;
  readonly kind: ConstructionKind;
  progressTicks: number;
  readonly totalTicks: number;
  /** Только для road: гексы без дороги в порядке прокладки, по одному за ROAD_BUILD_S_PER_HEX. */
  readonly path?: readonly HexId[];
}

export type ArmyOrder = 'idle' | 'hold' | 'expand';

export interface Army {
  readonly id: number;
  readonly owner: number;
  readonly type: UnitType;
  /** fixed-point солдат. */
  soldiers: Fp;
  /** Организованность 0..ORG_MAX, fixed-point. */
  org: Fp;
  hex: HexId;
  order: ArmyOrder;
  /** Доля 0..1, fixed-point. */
  supplyLevel: Fp;
}

/** События тика для интерфейса и логов; очищаются в начале каждого тика. */
export type GameEvent =
  | {
      readonly t: 'commandRejected';
      readonly playerId: number;
      readonly command: string;
      readonly reason: string;
    }
  | {
      readonly t: 'constructionDone' | 'constructionCancelled';
      readonly playerId: number;
      readonly kind: ConstructionKind;
      readonly hex: HexId;
    };

export interface MatchState {
  tick: number;
  readonly seed: number;
  readonly map: MapStatic;
  readonly hexes: HexState;
  /** Отсортированы по id. */
  readonly cities: City[];
  /** Индекс в массиве равен id игрока. */
  readonly players: Player[];
  /** Отсортированы по id. */
  readonly armies: Army[];
  /** Отсортированы по id. */
  readonly constructions: Construction[];
  nextId: number;
  events: GameEvent[];
}
