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
  /** Id сети снабжения узла (свой гекс с дорогой или городом) или -1; кэш networkSystem. */
  readonly network: Int32Array;
}

/** Сеть снабжения — компонента связности узлов одного игрока. */
export interface SupplyNetwork {
  /** owner × размер карты + наименьший HexId компоненты: уникально и детерминированно. */
  readonly id: number;
  readonly owner: number;
  /** Содержит столицу. */
  readonly isMain: boolean;
}

export interface City {
  readonly id: number;
  readonly hex: HexId;
  owner: number;
  level: number;
  /** Название с карты; у столиц пустое — имя выбирает интерфейс. */
  readonly name: string;
  /** Оборона города: гарнизон нейтрального или ополчение города игрока, fixed-point солдат. */
  defenders: Fp;
  /** Организованность обороны города, fixed-point. */
  defenseOrg: Fp;
  /** Гекс города атакован в этом тике — ополчение не восстанавливается. */
  inBattle: boolean;
  /** Сколько тиков осталось до полной выработки после захвата; 0 — полная. */
  captureTicks: number;
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
  /** Казна пуста и баланс отрицательный (02-economy.md, «Банкротство»); ставит economySystem. */
  bankrupt: boolean;
  /** Сколько армий игрок создал за матч — следующий номер армии. */
  armiesCreated: number;
  /** «Автопополнение»: новый отряд сразу уходит в самую нуждающуюся армию (CR-001). */
  autoReinforce: boolean;
  /** Тики «смуты» после переноса столицы: доход × CAPITAL_CHAOS_INCOME_MULT. */
  chaosTicks: number;
  /** Сколько тиков подряд у игрока нет городов. */
  noCityTicks: number;
  /** Тик выбывания или -1 — для мест выбывших. */
  eliminatedTick: number;
}

/** Набор в городе: люди и золото уже списаны, отряд появится по завершении. Один на город. */
export interface Recruitment {
  readonly id: number;
  readonly owner: number;
  readonly cityId: number;
  readonly type: UnitType;
  /** fixed-point солдат. */
  readonly soldiers: Fp;
  progressTicks: number;
  readonly totalTicks: number;
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

/**
 * move — идёт по path; attack — атакует соседний гекс target; retreat — отступает (приказы не
 * принимает); expand — экспансия; idle и hold — стоит.
 */
export type UnitOrder = 'idle' | 'hold' | 'expand' | 'move' | 'attack' | 'retreat';

export interface Unit {
  readonly id: number;
  readonly owner: number;
  readonly type: UnitType;
  /** fixed-point солдат. */
  soldiers: Fp;
  /** Организованность 0..ORG_MAX, fixed-point. */
  org: Fp;
  hex: HexId;
  order: UnitOrder;
  /** Доля 0..1, fixed-point. */
  supplyLevel: Fp;
  /** Оставшиеся гексы пути, следующий — первый; пусто, если отряд не идёт. */
  path: HexId[];
  /** Прогресс текущего перехода в path[0], тики. */
  moveTicks: number;
  /** Длительность текущего перехода, тики; 0 — переход не начат. */
  moveTotal: number;
  /** Армия отряда или null — резерв (CR-001). */
  armyId: number | null;
  /** Сколько тиков подряд снабжённость ниже ATTRITION_THRESHOLD — таймер истощения. */
  lowSupplyTicks: number;
  /** Котёл: нет пути по своим гексам ни к одной сети снабжения. */
  encircled: boolean;
  /** Цель атаки (соседний гекс) при приказе attack, иначе -1. */
  target: HexId;
  /** Участвует в бою в этом тике (атакует, обороняется, под обстрелом) — org не восстанавливается. */
  inBattle: boolean;
  /** Артиллерия: фокус огня (id вражеского отряда) или -1 — автоцель. */
  focus: number;
  /** Артиллерия: по кому бьёт в этом тике, или -1. */
  fireTarget: number;
  /** Место, выданное распределителем плана армии, или -1 (нет плана или ручной приказ). */
  slot: HexId;
}

/** План армии (CR-002): линия фронта против соседа (вся или участок) или линия обороны. */
export type ArmyPlan =
  | {
      readonly armyId: number;
      readonly kind: 'front';
      readonly enemyId: number;
      /** Концы участка на границе; null — вся граница с соседом. */
      readonly section: readonly [HexId, HexId] | null;
    }
  | {
      readonly armyId: number;
      readonly kind: 'line';
      /** Гексы линии обороны по порядку, достроенные между точками игрока. */
      readonly hexes: readonly HexId[];
    };

/** Армия — группа отрядов игрока с названием (05-armies.md, «Модель», CR-001). */
export interface Army {
  readonly id: number;
  readonly owner: number;
  /** Порядковый номер армии у игрока: 1, 2, …; интерфейс называет по нему армию без имени. */
  readonly number: number;
  /** Имя, заданное игроком; пустое — «N-я армия». */
  name: string;
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
      readonly t: 'unitRecruited' | 'recruitCancelled';
      readonly playerId: number;
      readonly cityId: number;
      readonly type: UnitType;
    }
  | {
      readonly t: 'unitDestroyed' | 'unitRetreated' | 'unitCapitulated';
      readonly playerId: number;
      readonly unitId: number;
    }
  | {
      readonly t: 'cityCaptured' | 'capitalMoved';
      readonly playerId: number;
      readonly cityId: number;
    }
  | { readonly t: 'playerEliminated'; readonly playerId: number }
  | { readonly t: 'matchWon'; readonly playerId: number; readonly reason: WinReason }
  | {
      readonly t: 'constructionDone' | 'constructionCancelled';
      readonly playerId: number;
      readonly kind: ConstructionKind;
      readonly hex: HexId;
    };

/** Как выиграна партия (08-match.md, «Победа»). */
export type WinReason = 'cities' | 'lastStanding' | 'score';

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
  readonly units: Unit[];
  /** Армии — группы отрядов, отсортированы по id. */
  readonly armies: Army[];
  /** Планы армий, отсортированы по armyId; у армии не больше одного плана. */
  readonly plans: ArmyPlan[];
  /** Отсортированы по id. */
  readonly constructions: Construction[];
  /** Отсортированы по id. */
  readonly recruits: Recruitment[];
  /** Кэш сетей снабжения, отсортирован по id; пересчёт размазан по игрокам (sim-core.md). */
  networks: SupplyNetwork[];
  nextId: number;
  events: GameEvent[];
  /** Победитель или -1; матч не замораживается — остановку делает сервер. */
  winner: number;
  /** Игрок, держащий ≥ VICTORY_CITY_SHARE городов, и сколько тиков подряд; -1 — никто. */
  holdPlayer: number;
  holdTicks: number;
}
