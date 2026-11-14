// Состояние матча. Архитектура: docs/architecture/sim-core.md — «Состояние».
// Поля боёв, сетей, фронтов и строек добавляются в этапах, где появляются их системы.
import type { UnitType } from '../balance.ts';
import type { MapStatic } from '../map/types.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';

/** Владелец гекса или города: id игрока либо NEUTRAL. */
export const NEUTRAL = -1;

/** Коды постройки гекса в hexes.building; 0 — нет постройки. */
/**
 * Постройки гекса. Склад — пять уровней: коды `depot` (1) … `depot5` (5); уровень склада
 * определяет `depotLevel`.
 */
export const BUILDING = {
  none: 0,
  fort: 1,
  fort2: 2,
  fort3: 3,
  depot: 4,
  depot2: 8,
  depot3: 12,
  depot4: 16,
  depot5: 20,
} as const;

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
  /** Название: с карты у ничьих городов, у основанных игроком и столиц — из списка, игрок переименует. */
  name: string;
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
  /** Ник; сервер меняет его, когда человек подсаживается на место бота. */
  name?: string;
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
  /** Настройка «Автокомандование»: новые армии получают auto (CR-006). */
  autoCommand: boolean;
  /** Тики «смуты» после переноса столицы: доход × CAPITAL_CHAOS_INCOME_MULT. */
  chaosTicks: number;
  /** Сколько тиков подряд у игрока нет городов. */
  noCityTicks: number;
  /** Тик выбывания или -1 — для мест выбывших. */
  eliminatedTick: number;
  /** Свой список названий городов игрока: новые города берут их по порядку (нет — слоговые названия). */
  cityPool?: readonly string[];
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
  /** Армия, которая заказала набор (закупка под заказ численности): отряд приходит прямо в неё. */
  readonly armyId?: number;
}

export type ConstructionKind =
  | 'foundCity'
  | 'upgradeCity'
  | 'improve'
  | 'fort'
  | 'upgradeFort'
  | 'depot'
  | 'upgradeDepot'
  | 'road';

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
  /** Дорога проложена игроком вручную: ей не нужен город или склад на конце. */
  readonly manual?: boolean;
}

/**
 * move — идёт по path; attack — атакует соседний гекс target; retreat — отступает (приказы не
 * принимает); idle — стоит.
 */
export type UnitOrder = 'idle' | 'move' | 'attack' | 'retreat';

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
  /** Отряд плывёт по воде между портами: путь по воде, снабжения и приказов нет, пока не причалит. */
  sea: boolean;
  /** Порт, из которого отряд вышел в море (его вместимость занята отрядом); −1 — не в море. */
  seaFrom: number;
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
  /** Звёзды опыта армии отряда 0..3, выводятся системой опыта; нет поля — ноль (резерв без звёзд). */
  stars?: number;
  /** Гекс сбора при приказе gather (CR-010) или -1. */
  gather: HexId;
  /** Гекс, из которого отряд вышел последним, и тик ухода: автоматика не возвращает его туда сразу (return-lock.ts). */
  came?: HexId;
  cameTick?: number;
}

/** Линия наступления (CR-004): грани, как нарисовал игрок, и гексы линии со стороны фронта. */
export interface OffensiveLine {
  /** Грани линии по порядку (EdgeId = hex × 6 + d). */
  readonly edges: readonly number[];
  /** Гексы линии — у каждой грани тот, что ближе к фронту армии в момент приказа. */
  readonly hexes: readonly HexId[];
  /** Наступление идёт (кнопка «Начать наступление», CR-005); false — линия только нарисована. */
  readonly active: boolean;
  /**
   * Тик последнего продвижения: приказ, «Начать», шаг к линии или бой отряда армии. Дольше
   * OFFENSIVE_STUCK_TICKS без продвижения — армия «упёрлась» (04/T14b).
   */
  readonly progressTick: number;
  /** Гексы, куда этим наступлением сделаны шаги, по возрастанию HexId (для анклавов, 04/T14b). */
  readonly taken: readonly HexId[];
}

/**
 * План армии (CR-002…CR-004): участок фронта — грани своей границы (с врагом или ничьей землёй)
 * или линия обороны.
 */
export type ArmyPlan =
  | {
      readonly armyId: number;
      readonly kind: 'front';
      /** Грани своей границы по порядку (со своей стороны); едут за границей (setHexOwner). */
      readonly edges: readonly number[];
      /** Линия наступления — граница «до куда» (07-controls.md); null — наступления нет. */
      readonly offensive: OffensiveLine | null;
      /**
       * Свои гексы у фронта, взятые врагом (07-controls.md, «Автокомандование»): commander их
       * отбивает; гекс выбывает, когда снова свой или больше не у фронта.
       */
      readonly lost?: readonly HexId[];
      /** Нажата ▶ у армии с auto без линии наступления: линию строит commander (CR-006). */
      readonly startWanted?: boolean;
      /**
       * Фронт направления: игрок-цель (или -1), на границу с блоком которой фронт лежит ровно, без
       * эвристик «поездки» граней; пересчитывается по границе, когда сменился владелец гекса.
       */
      readonly derived?: number;
      /** Версия владельцев гексов (`supplyRevision`), по которой пересчитан фронт направления. */
      readonly rev?: number;
    }
  | {
      readonly armyId: number;
      readonly kind: 'line';
      /** Гексы линии обороны по порядку, достроенные между точками игрока. */
      readonly hexes: readonly HexId[];
    };

/** Состав лимита армии: сколько солдат из лимита — танки и артиллерия; остальное — пехота. */
export interface ArmyMix {
  readonly armor: number;
  readonly artillery: number;
}

/** Армия — группа отрядов игрока с названием (05-armies.md, «Модель», CR-001). */
export interface Army {
  readonly id: number;
  readonly owner: number;
  /** Порядковый номер армии у игрока: 1, 2, …; интерфейс называет по нему армию без имени. */
  readonly number: number;
  /** Имя, заданное игроком; пустое — «N-я армия». */
  name: string;
  /** Автокомандование: армией командует commander (CR-006). */
  auto: boolean;
  /** Опыт армии, тиков боя; нет поля — ноль. Звёзды выводятся из него (`systems/experience.ts`). */
  xp?: number;
  /**
   * Заказанная численность, солдат (целое): ИИ закупает недостающих в ближайших к фронту городах
   * и подводит их. Нет поля — закупки нет (меню страны, `launchOffensive`).
   */
  wanted?: number;
  /**
   * Игрок только что задал лимит командой: армия один раз отпускает лишнее в резерв. Без этого
   * избыток от добора (отряд крупнее нехватки) отпускался бы и добирался по кругу.
   */
  trim?: boolean;
  /** Состав заказа по типам; нет поля — тип не важен, закупается пехота. */
  mix?: ArmyMix;
  /** Армия выполняет приказ морского вторжения (`invade`); значок якоря только у такой армии. */
  invading?: true;
  /** Куда идёт десант: гекс высадки и кому он принадлежал; по высадке армия сама встаёт на плацдарм. */
  landing?: { readonly hex: number; readonly target: number };
  /**
   * Направление армии: цель (id игрока или -1 — ничья земля) и режим. «hold» держит всю границу с
   * игроком (фронт обновляется по мере появления новых кусков), «attack» ведёт наступление.
   */
  dir?: {
    readonly target: number;
    readonly mode: 'hold' | 'attack' | 'idle';
    /** Охват — весь блок врагов цели (её союзники на войне с нами); нет поля — только сама страна. */
    readonly bloc?: true;
    /** Плацдарм десанта: фронт — только граница той части своей земли, где стоит этот гекс. */
    readonly pocket?: number;
    /** Гекс клика наступления: удар повторяется, пока он не взят. */
    readonly hex?: number;
    /**
     * Временная оборона: наступление встало или ударить нечем — армия держит границу и в этот
     * тик пробует наступать снова. Нет поля — оборона постоянная (приказ игрока).
     */
    readonly resume?: number;
  };
}

/** События тика для интерфейса и логов; очищаются в начале каждого тика. */
export type GameEvent =
  | {
      readonly t: 'commandRejected';
      readonly playerId: number;
      readonly command: string;
      readonly reason: string;
      /** Команда commander (CR-006): интерфейс игроку её отказ не показывает. */
      readonly auto: boolean;
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
      readonly hex: HexId;
    }
  | {
      readonly t: 'cityCaptured';
      readonly playerId: number;
      readonly cityId: number;
      readonly previousOwnerId: number;
      readonly newOwnerId: number;
    }
  | {
      readonly t: 'capitalMoved';
      readonly playerId: number;
      readonly cityId: number;
    }
  | {
      readonly t: 'warDeclared' | 'treatyMade' | 'treatyBroken' | 'treatyOffered';
      readonly playerId: number;
      readonly targetId: number;
      /** peace, pact или alliance (договор); для войны — какой договор нарушен или null. */
      readonly kind: TreatyKind | null;
    }
  | { readonly t: 'playerEliminated'; readonly playerId: number }
  | { readonly t: 'offensiveDone'; readonly playerId: number; readonly armyId: number }
  | {
      readonly t: 'matchWon';
      readonly playerId: number;
      readonly reason: WinReason;
      /** Победившая коалиция (с playerId во главе); нет поля — победил один игрок. */
      readonly allies?: readonly number[];
    }
  | {
      readonly t: 'constructionDone' | 'constructionCancelled';
      readonly playerId: number;
      readonly kind: ConstructionKind;
      readonly hex: HexId;
    };

/** Как выиграна партия (08-match.md, «Победа»). */
export type WinReason = 'land' | 'lastStanding' | 'coalition';

/** Отношение пары игроков (дипломатия, CR-007). */
export type Relation = 'peace' | 'war' | 'pact' | 'defense' | 'alliance';

/** Вид договора: мир (из войны), пакт о ненападении, оборонительный пакт, альянс. */
export type TreatyKind = 'peace' | 'pact' | 'defense' | 'alliance';

/** Предложение договора, действует OFFER_TTL_TICKS. */
export interface TreatyOffer {
  readonly from: number;
  readonly to: number;
  readonly kind: TreatyKind;
  readonly tick: number;
}

export interface Diplomacy {
  /** Симметричная матрица игроков n × n, индекс a * n + b. */
  relation: Relation[];
  /** Нарушений договоров у каждого игрока: разорванные пакты и союзы, война против партнёра. */
  violations: number[];
  offers: TreatyOffer[];
  /**
   * Отношения игроков, матрица n × n, индекс a * n + b: как a относится к b, от −ATTITUDE_MAX
   * (заклятый враг) до +ATTITUDE_MAX (друг). Меняют публичные поступки: война, договоры, захваты.
   */
  attitude?: number[];
  /** Тик последней смены отношения пары, матрица n × n: возраст войны или договора для решений ботов. */
  changedAt?: number[];
  /** Запросы помощи оборонительного пакта: ally спрашивают, вступить ли в войну с aggressor за victim. */
  calls?: AidCall[];
  /** Идущие войны по оборонительному пакту: ally воюет за victim с aggressor (общий обзор и проход). */
  aid?: AidWar[];
  /** Голосования альянса (вход новых членов, общий мир). */
  votes?: AllianceVote[];
  /** Итоги недавних голосований: видны игрокам, чтобы быстрый ответ ботов не прятал исход. */
  results?: VoteResult[];
  /** Номер следующего голосования. */
  nextVote?: number;
  /** Паузы после отказа в голосовании: то же предложение не открывается снова до `until`. */
  locks?: VoteLock[];
}

/** Пауза после отклонённого голосования: `a` — инициатор, `b` — цель (для исключения — исключаемый). */
export interface VoteLock {
  readonly kind: AllianceVote['kind'];
  readonly a: number;
  readonly b: number;
  readonly until: number;
}

/** Итог голосования: кто как ответил и принято ли; живёт RESULT_TTL_TICKS. */
export interface VoteResult {
  readonly id: number;
  readonly kind: AllianceVote['kind'];
  readonly a: number;
  readonly b: number;
  readonly voters: readonly number[];
  readonly sides?: readonly (readonly number[])[];
  readonly yes: readonly number[];
  readonly no: readonly number[];
  readonly passed: boolean;
  readonly tick: number;
}

export interface AidCall {
  readonly ally: number;
  readonly victim: number;
  readonly aggressor: number;
  readonly tick: number;
}

export interface AidWar {
  readonly ally: number;
  readonly victim: number;
  readonly aggressor: number;
  /** Тик конца войны: проход по земле пострадавшего ещё открыт, пока отряды идут домой. */
  ending?: number;
}

/** join — a и b становятся одним альянсом; peace — общий мир между сторонами a и b; kick — исключить b из альянса по предложению a. */
export interface AllianceVote {
  readonly id: number;
  readonly kind: 'join' | 'peace' | 'kick';
  readonly a: number;
  readonly b: number;
  /** Избиратели: члены обеих групп (для join — без одиночного новичка). */
  readonly voters: readonly number[];
  /** Общий мир: стороны, каждая из которых с альянсом решает большинством своих членов. */
  readonly sides?: readonly (readonly number[])[];
  yes: number[];
  no: number[];
  readonly tick: number;
}

export interface MatchState {
  tick: number;
  readonly seed: number;
  fog: boolean;
  readonly map: MapStatic;
  readonly hexes: HexState;
  /** Кэш обзора и последних известных данных, обновляемый visionSystem. */
  vision?: VisionState;
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
  /** Производительность сетей после распределения спроса; кэш для HUD, не часть хэша. */
  supplyRatios: Map<number, Fp>;
  /** Ревизия владельцев и зданий для кэша карт потерь снабжения. */
  supplyRevision: number;
  nextId: number;
  events: GameEvent[];
  /** Дипломатия; нет — все игроки в войне друг с другом (режим без дипломатии). */
  diplomacy?: Diplomacy;
  /** Победитель или -1; матч не замораживается — остановку делает сервер. */
  winner: number;
  /** Матч-урок: победа не фиксируется. */
  noVictory?: boolean;
  /** Игрок, держащий ≥ VICTORY_LAND_SHARE суши, и оставшиеся тики; -1 — никто. */
  holdPlayer: number;
  holdTicks: number;
}

export interface VisionState {
  readonly visible: Uint8Array[];
  readonly explored: Uint8Array[];
  readonly road: Uint8Array[];
  readonly improvement: Uint8Array[];
  readonly building: Uint8Array[];
  readonly coverage: Uint16Array[];
  readonly ownerByHex: Int16Array;
  readonly roadByHex: Uint8Array;
  readonly improvementByHex: Uint8Array;
  readonly buildingByHex: Uint8Array;
  readonly unitSources: Map<number, VisionSource>;
  readonly citySources: Map<number, VisionSource>;
  readonly dirty: Set<number>[];
  /** Какие пары в союзе на момент последнего пересчёта: смена требует полного пересчёта обзора. */
  allianceKey: string;
  initialized: boolean;
}

export interface VisionSource {
  readonly owner: number;
  readonly hex: HexId;
}
