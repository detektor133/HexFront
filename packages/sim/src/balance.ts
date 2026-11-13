// Все числа баланса; повторяет docs/gdd/10-balance.md 1:1 и меняется только вместе с ним.
// Величины с единицами (золото, люди, солдаты, секунды, доли, множители, org) — fixed-point;
// счётчики (тики, гексы, радиусы, уровни, количества) — целые.
import { fp, intDiv, type Fp } from './math/int.ts';

/** Проходимая местность; вода в таблицы баланса не входит. */
export type LandTerrain = 'plains' | 'forest' | 'hills' | 'mountains' | 'desert';

/** Тип войск. */
export type UnitType = 'infantry' | 'armor' | 'artillery';

type ByTerrain<T> = Readonly<Record<LandTerrain, T>>;
type ByUnit<T> = Readonly<Record<UnitType, T>>;

// Время

export const TICK_MS = 100;
/** «1 с = 10 тиков» из шапки 10-balance.md. */
export const TICKS_PER_S = intDiv(1000, TICK_MS);
export const NETWORK_RECALC_TICKS = 10;
export const VISION_RECALC_TICKS = 10;
export const FRONT_ALLOC_TICKS = 50;
/** Сколько новых маршрутов отрядов армий с планами строится за один тик; остальные ждут следующего тика. */
export const FRONT_ROUTES_PER_TICK = 16;
export const OFFENSIVE_STEP_TICKS = 20;
/** Сколько тиков автоматика не возвращает отряд в гекс, который он только что покинул. */
export const RETURN_LOCK_TICKS = 150;
/**
 * Сколько тиков отряд, снятый с плана ручным приказом, должен простоять без шага и боя, чтобы план
 * взял его обратно: отряд не «тусуется» на месте приказа, а возвращается на линию армии.
 */
export const DETACH_REJOIN_TICKS = 200;
/** Наступление без продвижения дольше этого — значок «упёрлись» (07-controls.md, 04/T14b). */
export const OFFENSIVE_STUCK_TICKS = 100;
/** Наступление без шага и боя дольше этого, тиков, командир меняет: оси — на другой участок, нечем бить — оборона. */
export const OFFENSIVE_STALL_TICKS = 300;
/** Через сколько тиков армия во временной обороне пробует наступать снова. */
export const OFFENSIVE_RETRY_TICKS = 200;
/**
 * Период вызова commander для игрока (все его армии с автокомандованием — в один тик; игроки
 * распределены по тикам по id), тиков (07-controls.md, CR-006).
 */
export const COMMANDER_TICKS = 5;
export const BOT_THINK_TICKS = 10;
/** Период экономического решения easy-бота, тиков. */
export const BOT_EASY_THINK_TICKS = 30;
/** Средняя сложность: как часто бот думает, тиков. */
export const BOT_NORMAL_THINK_TICKS = 20;
/** Слабые боты командуют армиями реже: commander ходит раз в столько своих очередей. */
export const BOT_EASY_COMMANDER_EVERY = 3;
export const BOT_NORMAL_COMMANDER_EVERY = 2;
/** Война живёт не меньше стольких тиков (90 с), прежде чем бот согласится на мир, если не проигрывает. */
export const BOT_WAR_MIN_TICKS = 900;
/** Армию бота делят под новый фронт, только если в ней не меньше стольких солдат: мелкие половины не воюют. */
export const BOT_SPLIT_MIN_SOLDIERS = fp(600);
/** Победитель в войне устаёт и соглашается на мир, когда война идёт дольше стольких тиков (10 мин). */
export const BOT_WAR_WEARY_TICKS = 6000;
/** Бот не нападает на того, с кем только что помирился: столько тиков (5 мин) мира должно пройти. */
export const BOT_PEACE_LOCK_TICKS = 3000;
/** Пакт или союз бот не рвёт ради добычи, пока ему нет столько тиков (3 мин). */
export const BOT_PACT_MIN_TICKS = 1800;
/** Первые 5 минут матча боты не объявляют войну: игрок успевает расти, а не отбиваться на старте. */
export const BOT_WAR_GRACE_TICKS = 3000;

// Отношения игроков (дипломатия; 08-match.md, «Отношения») [ДИЗАЙН-РЕШЕНИЕ 2026-11-12]

/** Предел отношения a → b в обе стороны: −ATTITUDE_MAX — заклятый враг, +ATTITUDE_MAX — верный друг. */
export const ATTITUDE_MAX = 1000;
/** Объявил войну мне: моё отношение к нему падает на столько. */
export const ATT_WAR_ON_ME = 400;
/** Объявил войну моему союзнику или партнёру по оборонительному пакту. */
export const ATT_WAR_ON_FRIEND = 150;
/** Нарушил договор: на столько падает отношение к нему у всех остальных (предатель известен всем). */
export const ATT_BREACH_PUBLIC = 100;
/** Отнял мой город. */
export const ATT_CITY_LOST = 150;
/** Договор заключён: отношение обеих сторон растёт на столько по ступеням (мир, пакт, оборонительный, альянс). */
export const ATT_TREATY_GAIN = { peace: 40, pact: 120, defense: 200, alliance: 300 } as const;
/** Раз в столько тиков отношения «остывают» к нулю на 1, а у партнёров по договору растут. */
export const ATT_PERIOD_TICKS = 50;
/** Прирост отношения партнёров за период и его потолок. */
export const ATT_PARTNER_GROWTH = 2;
export const ATT_PARTNER_CAP = 600;

// Боты (09-bots.md, «Utility AI»; 04/T23) [ТЮНИНГ]

/**
 * Профиль сложности бота: решения в дипломатии и на войне (09-bots.md, «Уровни»). Все отношения —
 * fixed-point (FP = 1,0): «сила к силе», «армия к видимому врагу».
 */
export interface BotProfile {
  /** Во сколько раз армия должна превосходить видимого врага у фронта, чтобы начать наступление. */
  readonly attackRatio: Fp;
  /** Ниже этого перевеса идущее, но застрявшее наступление останавливается, силы копятся. */
  readonly holdRatio: Fp;
  /** Сколько войн бот ведёт одновременно. */
  readonly maxWars: number;
  /** Перевес сил над целью (очки матча), нужный для объявления войны. */
  readonly warEdge: Fp;
  /** Как часто бот предлагает договоры, тиков. */
  readonly proposeEvery: number;
  /** Доля очков лидера в сумме очков живых, процентов, с которой бот видит в нём угрозу; 0 — не замечает. */
  readonly alarmPercent: number;
  /** Строит коалиции: предлагает оборонительные пакты и альянсы, зовёт на общего врага. */
  readonly coalitions: boolean;
  /** Готов нарушить договор ради выгодной цели (цена — нарушение, которое видят все). */
  readonly opportunist: boolean;
  /** Насколько обида влияет на выбор цели войны (очков отношения на единицу перевеса). */
  readonly grudge: number;
  /** Сколько армий бот держит под фронты: делит большую армию, когда кусков границы больше. */
  readonly maxArmies: number;
  /** Доля от предела государства (половина людей и армии), до которой бот растит заказ одной армии, процентов. */
  readonly armyCapPercent: number;
  /** Доля танков и артиллерии в заказе армии, процентов (состав карточки армии). */
  readonly armorPercent: number;
  readonly artilleryPercent: number;
  /**
   * Насколько падает нужный перевес над целью, если бот долго не воюет (тиков покоя сверх
   * BOT_RESTLESS_START_TICKS, линейно за BOT_RESTLESS_RAMP_TICKS): застоявшиеся боты начинают бить
   * соседей, а не сидеть в равных границах. Мирный сосед не вечно «слишком силён».
   */
  readonly restless: Fp;
}

/** Сколько тиков покоя (нет войн, мир не менялся) бот терпит, прежде чем его тянет воевать. */
export const BOT_RESTLESS_START_TICKS = 3000;
/** За сколько тиков нетерпение вырастает до полного значения профиля. */
export const BOT_RESTLESS_RAMP_TICKS = 3000;

/** Профили по уровням: лёгкий осторожен и пассивен, сложный — инициативен, строит коалиции и рвёт их. */
export const BOT_PROFILES: Readonly<Record<'easy' | 'normal' | 'medium', BotProfile>> = {
  easy: {
    attackRatio: fp(1.8),
    holdRatio: fp(1.2),
    maxWars: 1,
    warEdge: fp(1.6),
    proposeEvery: 1200,
    alarmPercent: 0,
    coalitions: false,
    opportunist: false,
    grudge: 0,
    maxArmies: 2,
    armyCapPercent: 30,
    armorPercent: 0,
    artilleryPercent: 0,
    restless: fp(0),
  },
  normal: {
    attackRatio: fp(1.2),
    holdRatio: fp(0.8),
    maxWars: 2,
    warEdge: fp(1.2),
    proposeEvery: 600,
    alarmPercent: 40,
    coalitions: true,
    opportunist: false,
    grudge: 150,
    maxArmies: 3,
    armyCapPercent: 40,
    armorPercent: 10,
    artilleryPercent: 10,
    restless: fp(0.25),
  },
  medium: {
    attackRatio: fp(1),
    holdRatio: fp(0.7),
    maxWars: 2,
    warEdge: fp(1),
    proposeEvery: 300,
    alarmPercent: 28,
    coalitions: true,
    opportunist: true,
    grudge: 250,
    maxArmies: 4,
    armyCapPercent: 50,
    armorPercent: 15,
    artilleryPercent: 15,
    restless: fp(0.45),
  },
};

/** Максимальная глубина линии наступления бота, гексов. */
export const BOT_LINE_MAX_DEPTH = 6;

export const PREP_TIME_S: Fp = fp(5);

// Местность

/** Лимит населения гекса, людей. */
export const BASE_POP_CAP: ByTerrain<Fp> = {
  plains: fp(100),
  forest: fp(60),
  hills: fp(50),
  mountains: fp(25),
  desert: fp(30),
};
/** Базовое время перехода в гекс при скорости 1,0, секунд. */
export const MOVE_TIME_S: ByTerrain<Fp> = {
  plains: fp(2.0),
  forest: fp(3.0),
  hills: fp(3.0),
  mountains: fp(5.0),
  desert: fp(2.5),
};
/** Множитель обороны защитника. */
export const DEF_MULT: ByTerrain<Fp> = {
  plains: fp(1.0),
  forest: fp(1.25),
  hills: fp(1.25),
  mountains: fp(1.6),
  desert: fp(1.0),
};
/** Потеря снабжения на гекс вне дорог, доля. */
export const OFFROAD_SUPPLY_LOSS: ByTerrain<Fp> = {
  plains: fp(0.08),
  forest: fp(0.1),
  hills: fp(0.1),
  mountains: fp(0.17),
  desert: fp(0.1),
};

export const RIVER_MOVE_PENALTY_S: Fp = fp(1.0);
export const RIVER_ATTACK_MULT: Fp = fp(0.7);
export const ROAD_MOVE_MULT: Fp = fp(0.5);
export const ZOC_MOVE_MULT: Fp = fp(2.0);
export const FERTILE_CAP_MULT: Fp = fp(1.5);
export const MINE_GOLD_PER_S: Fp = fp(1.0);
/** Минимальная дистанция между любыми городами, гексов. */
export const CITY_MIN_DISTANCE = 4;
export const PASSABLE_HEXES_PER_PLAYER = 120;
export const EUROPE_MAP_MIN_LONGITUDE = -11;
export const EUROPE_MAP_MAX_LONGITUDE = 40;
export const EUROPE_MAP_MIN_LATITUDE = 35;
export const EUROPE_MAP_MAX_LATITUDE = 71;
export const EUROPE_MAP_TARGET_PLAYERS = 30;
export const MAPGEN_MAX_PLAYERS = 100;
export const NEUTRAL_CITIES_PER_PLAYER: Fp = fp(1.5);
/** Гарнизон нейтрального города по уровню 1/2/3, солдат. */
export const NEUTRAL_GARRISON: readonly [Fp, Fp, Fp] = [fp(37), fp(75), fp(150)];

// Население и налог

export const GROWTH_CITY_HEX: Fp = fp(3.0);
export const GROWTH_RING1: Fp = fp(1.5);
export const GROWTH_RING2: Fp = fp(0.5);
/** Фоновый рост своих гексов вне радиуса 2 городов, людей/с. */
export const GROWTH_BACKGROUND: Fp = fp(0.4);
export const CITY_LEVEL_GROWTH_STEP: Fp = fp(0.25);
export const POP_OVERCAP_DECAY: Fp = fp(0.01);
export const CAPTURE_POP_LOSS_HEX: Fp = fp(0.2);
export const CAPTURE_POP_LOSS_CITY: Fp = fp(0.3);
export const TAX_MIN: Fp = fp(0);
export const TAX_MAX: Fp = fp(0.4);
export const TAX_STEP: Fp = fp(0.05);
export const TAX_DEFAULT: Fp = fp(0.2);
export const TAX_SLEW_PER_S: Fp = fp(0.02);
export const TAX_GROWTH_AT_0: Fp = fp(1.4);
export const TAX_GROWTH_AT_20: Fp = fp(1.0);
export const TAX_GROWTH_AT_40: Fp = fp(0.1);
export const GOLD_PER_POP_TAX: Fp = fp(0.01);
export const ISOLATED_INCOME_MULT: Fp = fp(0.5);
export const ISOLATED_SUPPLY_MULT: Fp = fp(0.5);
export const ISOLATED_GROWTH_MULT: Fp = fp(0.75);
/** Снабжённость отрядов при банкротстве (02-economy.md, «Банкротство»). */
export const BANKRUPT_SUPPLY_MULT: Fp = fp(0.5);

// Города и постройки

export const CITY_POP_CAP_PER_LEVEL: Fp = fp(300);
export const CITY_SUPPLY_PER_LEVEL: Fp = fp(250);
export const CAPITAL_SUPPLY_BONUS: Fp = fp(250);
export const CITY_GOLD_PER_LEVEL: Fp = fp(0.5);
export const MILITIA_PER_LEVEL: Fp = fp(100);
/** Восстановление ополчения вне боя, солдат в секунду. */
export const MILITIA_REGEN_PER_S: Fp = fp(4);
export const CITY_DEF_MULT: Fp = fp(1.3);
export const CITY_FOUND_BASE_COST: Fp = fp(120);
export const CITY_FOUND_COST_STEP: Fp = fp(0.5);
export const CITY_FOUND_MIN_POP_RATIO: Fp = fp(0.6);
export const CITY_FOUND_TIME_S: Fp = fp(30);
/** Цена улучшения до уровней 2..5, золото. */
export const CITY_UPGRADE_COST: readonly [Fp, Fp, Fp, Fp] = [fp(100), fp(200), fp(350), fp(550)];
/** Время улучшения до уровней 2..5, секунд. */
export const CITY_UPGRADE_TIME_S: readonly [Fp, Fp, Fp, Fp] = [fp(20), fp(30), fp(40), fp(50)];
export const CAPTURED_OUTPUT_START: Fp = fp(0.25);
export const CAPTURED_RAMP_S: Fp = fp(60);
export const CAPITAL_MOVE_CHAOS_S: Fp = fp(30);
/** Доход во время «смуты» после переноса столицы (03-cities-buildings.md, «Столица»). */
export const CAPITAL_CHAOS_INCOME_MULT: Fp = fp(0.5);
export const NO_CITY_GRACE_S: Fp = fp(60);
/** Цена благоустройства уровней 1..3, золото. */
export const IMPROVEMENT_COST: readonly [Fp, Fp, Fp] = [fp(20), fp(40), fp(80)];
/** Время благоустройства уровней 1..3, секунд. */
export const IMPROVEMENT_TIME_S: readonly [Fp, Fp, Fp] = [fp(5), fp(8), fp(12)];
export const IMPROVEMENT_CAP_STEP: Fp = fp(0.5);
export const IMPROVEMENT_GROWTH_STEP: Fp = fp(0.3);
export const FORT_COST: Fp = fp(60);
export const FORT_TIME_S: Fp = fp(10);
/** Множитель обороны укрепления уровней 1–3 (3 — укрепрайон). */
export const FORT_DEF_MULTS: readonly Fp[] = [fp(1.4), fp(1.8), fp(2.4)];
export const FORT_DEF_MULT: Fp = fp(1.4);
/** Улучшение укрепления с уровня 1 и 2: цена, золото; время, секунды. */
export const FORT_UPGRADE_COST: readonly Fp[] = [fp(100), fp(200)];
export const FORT_UPGRADE_TIME_S: readonly Fp[] = [fp(15), fp(20)];
export const DEPOT_COST: Fp = fp(80);
export const DEPOT_TIME_S: Fp = fp(15);
export const DEPOT_RADIUS = 3;
/** Минимальная дистанция до любого склада или города, гексов. */
export const DEPOT_MIN_DISTANCE = 3;
export const DEPOT_LOSS_MULT: Fp = fp(0.5);
/** Снабжение, которое производит склад уровня 1–5 (единиц; 1 единица кормит 2 солдат пехоты). */
export const DEPOT_SUPPLY: readonly Fp[] = [fp(120), fp(240), fp(400), fp(600), fp(850)];
/** Улучшение склада с уровня 1..4: цена, золото; время, секунды. */
export const DEPOT_UPGRADE_COST: readonly Fp[] = [fp(120), fp(220), fp(350), fp(520)];
export const DEPOT_UPGRADE_TIME_S: readonly Fp[] = [fp(20), fp(30), fp(40), fp(50)];
/** Сколько точек можно задать дороге вручную. */
/** Вместимость порта за одну отправку на каждый уровень склада, солдат (fixed-point). */
export const PORT_CAPACITY_PER_LEVEL = 600 * 1000;
/** Дальше стольких клеток воды от порта плыть нельзя. */
export const SEA_MAX_HEXES = 40;
/** Время прохода одной клетки воды, секунд. */
export const SEA_MOVE_S_PER_HEX: Fp = fp(0.8);
/** Золото за одного солдата на одну клетку воды при вторжении и высадке не в свой порт. */
export const SEA_COST_PER_SOLDIER_HEX: Fp = fp(0.02);
export const ROAD_BUILD_S_PER_HEX: Fp = fp(1.5);
export const SUPPLY_REBUILD_COST_PER_HEX: Fp = fp(15);
/** Вес гекса существующей дороги при поиске пути. */
export const ROAD_PATH_EXISTING_COST: Fp = fp(0.01);

/** Определения построек для каталога действий бота. */
export const BUILDING_DEFS = {
  fort: { costGold: FORT_COST, defenseMult: FORT_DEF_MULT, supplyLossMult: fp(1), supplyRadius: 0 },
  depot: {
    costGold: DEPOT_COST,
    defenseMult: fp(1),
    supplyLossMult: DEPOT_LOSS_MULT,
    supplyRadius: DEPOT_RADIUS,
  },
} as const;

// Армии

export const COST_POP_PER_SOLDIER: ByUnit<Fp> = {
  infantry: fp(1),
  armor: fp(1),
  artillery: fp(1),
};
export const COST_GOLD_PER_SOLDIER: ByUnit<Fp> = {
  infantry: fp(0.1),
  armor: fp(1.0),
  artillery: fp(0.6),
};
export const UPKEEP_GOLD_PER_SOLDIER_S: ByUnit<Fp> = {
  infantry: fp(0.003),
  armor: fp(0.012),
  artillery: fp(0.008),
};
export const UPKEEP_GOLD_PER_UNIT_S: ByUnit<Fp> = {
  infantry: fp(0.05),
  armor: fp(0.05),
  artillery: fp(0.05),
};
export const ATK: ByUnit<Fp> = { infantry: fp(1.0), armor: fp(2.0), artillery: fp(0) };
export const DEF: ByUnit<Fp> = { infantry: fp(1.2), armor: fp(0.9), artillery: fp(0.6) };
/** Общий множитель скорости всех отрядов: время шага делится на него (игре нужны быстрые отряды). */
export const UNIT_SPEED_MULT: Fp = fp(1.5);
/** Скорость по местности; в таблице forest и hills — одна колонка. */
export const SPEED: ByUnit<ByTerrain<Fp>> = {
  infantry: {
    plains: fp(1.0),
    forest: fp(0.7),
    hills: fp(0.7),
    mountains: fp(0.5),
    desert: fp(0.9),
  },
  armor: { plains: fp(1.6), forest: fp(0.8), hills: fp(0.8), mountains: fp(0.5), desert: fp(1.4) },
  artillery: {
    plains: fp(0.7),
    forest: fp(0.5),
    hills: fp(0.5),
    mountains: fp(0.4),
    desert: fp(0.7),
  },
};
export const SUPPLY_PER_SOLDIER: ByUnit<Fp> = {
  infantry: fp(0.5),
  armor: fp(1.25),
  artillery: fp(0.75),
};
export const RECRUIT_BASE_S: ByUnit<Fp> = { infantry: fp(4), armor: fp(8), artillery: fp(6) };
/** В таблице — `_PER_100_S` рядом с `RECRUIT_BASE_S`: секунд на каждые 100 солдат. */
export const RECRUIT_PER_100_S: ByUnit<Fp> = {
  infantry: fp(0.5),
  armor: fp(1),
  artillery: fp(0.75),
};

/**
 * Опыт армии (звёзды): тиков боя до 1, 2, 3 звезды и бонусы звёзд в процентах — сила в бою,
 * организация (регенерация и меньшие потери org), скорость восполнения потерь. [ТЮНИНГ]
 */
export const XP_STAR_TICKS = [450, 1800, 4800] as const;
export const STAR_POWER_PCT = [3, 7, 12] as const;
export const STAR_ORG_PCT = [3, 7, 12] as const;
export const STAR_REPLENISH_PCT = [10, 20, 35] as const;

/** Уровни размера армии (рота…корпус): знаменатели доли от предела государства (люди плюс армия). */
export const ARMY_LEVEL_DENOMS = [16, 8, 4, 2, 1] as const;

export const RECRUIT_MIN: Fp = fp(50);
export const RECRUIT_STEP: Fp = fp(50);
export const RECRUIT_MIN_HEX_POP_RATIO: Fp = fp(0.1);
/** Радиус занятия ничьей земли вокруг клика: база, надбавка за каждые N солдат заказа и предел. */
export const EXPAND_RADIUS_BASE = 3;
export const EXPAND_SOLDIERS_PER_HEX = 100;
export const EXPAND_RADIUS_MAX = 10;
/** Горный гекс при занятии «дальше» на столько гексов: сначала равнины, горы в последнюю очередь. */
export const EXPAND_MOUNTAIN_PENALTY = 8;
/** Цель волны (ничей город, столица) тянет занятие, только если ближе стольких гексов; дальше — плотный рост. */
export const EXPAND_PULL_RANGE = 6;
/** Ничей город штурмуют, только если он не дальше стольких гексов от своей земли (без анклавов). */
export const EXPAND_STORM_GAP = 2;
/** Вес «недостающего» своего соседа гекса: чем больше соседей свои, тем раньше его занимают. */
export const EXPAND_COMPACT_WEIGHT = 3;
/** Запрос помощи оборонительного пакта живёт столько тиков (30 с). */
export const AID_TTL_TICKS = 300;
/** После конца войны помощника проход по земле союзника открыт не дольше стольких тиков (60 с): отряды идут домой. */
export const AID_RETURN_TICKS = 600;
/** Итог голосования висит в интерфейсе стольких тиков (30 с). */
export const RESULT_TTL_TICKS = 300;
/** Бот отвечает в голосовании не раньше стольких тиков после его открытия (плюс разброс по игроку): человек успевает увидеть ход. */
export const BOT_VOTE_DELAY_TICKS = 30;
/** Голосование альянса живёт столько тиков (60 с); не решили — отказ. */
export const VOTE_TTL_TICKS = 600;
/** Слияние мелочи: отряд меньше порога стягивается к ближайшему своему в радиусе, раз в период. */
export const MERGE_SMALL_TINY: Fp = fp(25);
/** Мелочью в спокойном месте у армии без плана, у резерва и у армии с избытком отрядов считается всё, что меньше этого. */
export const MERGE_SMALL_BELOW: Fp = fp(150);
export const MERGE_SMALL_RADIUS = 4;
/** Предел отряда при слиянии мелочи и при вливании колонны в затор, солдат. */
export const CONSOLIDATE_CROWD = 12;
/** Предел отряда при слиянии для небольшого войска; у большого растёт: войско / CONSOLIDATE_UNITS_TARGET. */
export const CONSOLIDATE_MAX: Fp = fp(300);
export const CONSOLIDATE_UNITS_TARGET = 25;
export const CONSOLIDATE_MAX_CEIL: Fp = fp(1500);
/** Мелочь не стягивается, пока враг ближе стольких гексов: фронт у врага не трогаем. */
export const CONSOLIDATE_SAFE = 3;
export const CONSOLIDATE_PERIOD_S = 2;
/** Рой не занимает гексы ближе этого числа гексов к чужим отрядам. */
export const SWARM_SAFE = 6;
/** Оси удара направления: одна на каждые AXIS_SOLDIERS солдат заказа, не больше AXIS_MAX. */
export const AXIS_SOLDIERS = 300;
export const AXIS_MAX = 8;
/** Как часто ИИ обновляет линии идущего наступления, секунд. */
export const AXIS_REFRESH_S = 5;
/** Линия считается выполненной, когда взято не меньше этой доли её гексов, процентов. */
export const AXIS_DONE_PERCENT = 70;
/** Бот: одна ось на каждые столько граней фронта (широкий фронт — несколько осей). */
export const BOT_AXIS_EDGES = 14;
/** Штурм городов направлением: дальность поиска, размер группы и период решений. */
export const ASSAULT_REACH = 8;
/** Город штурмуют, только если он не дальше стольких гексов от своей земли: наступление сплошное, без червей. */
export const ASSAULT_GAP = 3;
export const ASSAULT_MAX_UNITS = 8;
/** Самый большой котёл (проходимых гексов), который закрывают отдельно от линии наступления: оси удара его не выбирают. */
export const POCKET_MAX_LAND = 60;
export const ASSAULT_PERIOD_S = 2;
/**
 * Наибольший набор, который ИИ ставит в одном городе за раз при закупке под заказ армии: большой
 * набор — один крупный отряд, который фронт при нужде делит сам, а не десятки мелких.
 */
export const PROCURE_BATCH: Fp = fp(1000);
/** В скольких городах сразу армия закупает за секунду: недобор делится между городами, а не ждёт один. */
export const PROCURE_CITIES = 6;
/** Крупный набор армии делится при выходе из города на отряды такого размера (остаток меньше RECRUIT_MIN идёт в последний). */
export const UNIT_SPLIT_SOLDIERS: Fp = fp(300);
/**
 * Предела отрядов одного игрока в гексе нет (решение владельца 2026-11-04); константа — лишь защита от
 * мусорных значений в проверках, до неё в игре не доходят.
 */
export const MAX_UNITS_PER_HEX = 1000;
export const UNIT_LIMIT_BASE = 4;
export const UNIT_LIMIT_PER_CITY = 2;
/** `START_UNITS` = 2 × 100 пехоты: количество и размер отдельно. */
export const START_UNITS = 2;
export const START_UNIT_SOLDIERS: Fp = fp(100);
export const START_UNIT_TYPE: UnitType = 'infantry';
export const START_GOLD: Fp = fp(200);
export const START_POP_CAPITAL: Fp = fp(200);
export const START_POP_HEX: Fp = fp(40);
export const START_HEXES = 3;
export const NEUTRAL_HEX_POP_RATIO: Fp = fp(0.2);

// Снабжение и бой

export const SUPPLY_COMBAT_BASE: Fp = fp(0.5);
export const ATTRITION_THRESHOLD: Fp = fp(0.5);
export const ATTRITION_GRACE_S: Fp = fp(20);
export const ATTRITION_MAX_PER_S: Fp = fp(0.02);
export const LOW_SUPPLY_SPEED_MULT: Fp = fp(0.75);
export const CASUALTY_RATE: Fp = fp(0.01);
export const ORG_MAX: Fp = fp(100);
export const ORG_LOSS_K: Fp = fp(6);
export const ORG_LOSS_MIN: Fp = fp(1);
export const ORG_LOSS_MAX: Fp = fp(20);
export const ORG_REGEN_PER_S: Fp = fp(4);
export const ORG_AFTER_RETREAT: Fp = fp(20);
export const RETREAT_SOLDIER_LOSS: Fp = fp(0.05);
export const RETREAT_MOVE_MULT: Fp = fp(0.7);
export const RETREAT_DAMAGE_TAKEN_MULT: Fp = fp(2.0);
export const FLANK_STEP: Fp = fp(0.15);
export const FLANK_MAX: Fp = fp(1.3);
export const ARTY_RANGE = 2;
export const ARTY_DMG_PER_SOLDIER_S: Fp = fp(0.004);
export const ARTY_ORG_DMG_PER_SOLDIER_S: Fp = fp(0.002);
/** Общая сила обстрела: +30 % к урону солдатам и организованности (константы выше слишком грубы для долей). */
export const ARTY_POWER_MULT: Fp = fp(1.3);
export const ARTY_SUPPORT_BONUS: Fp = fp(1.3);
export const ARTY_SUPPORT_MIN_SOLDIERS: Fp = fp(100);
export const ARTY_FLEE_LOSS: Fp = fp(0.1);
export const FORECAST_MARGIN: Fp = fp(0.9);
export const OFFENSIVE_STOP_ORG: Fp = fp(30);
export const MAX_ACTIVE_ARROWS = 3;
/** Вес гексов фронта с гранями, смотрящими на линию наступления, во время наступления. */
export const OFFENSIVE_FACING_WEIGHT = 3;
/**
 * Эшелон: отряд смотрящей грани шагает раз в столько шагов армии; соседи чередуются, поэтому
 * на каждом шаге половина отрядов — резерв, держит линию.
 */
export const OFFENSIVE_ECHELON_PERIOD = 2;
/** Сколько отрядов распределение ставит на один гекс наступающего фронта; остальные держат линию. */
export const OFFENSIVE_STACK = 2;
/** Избыток отрядов на линии фронта, с которого лишний отряд переходит на другую линию армии. */
export const FRONT_REBALANCE_SURPLUS = 2;
/** Надбавки к весу гекса фронта при распределении отрядов (07-controls.md, «Распределение»). */
export const FRONT_WEIGHT_CITY: Fp = fp(2);
export const FRONT_WEIGHT_CAPITAL: Fp = fp(3);
export const FRONT_WEIGHT_DEPOT: Fp = fp(1);
/** За каждую сторону света сверх первой, с которой гекс граничит с врагом (фланг). */
export const FRONT_WEIGHT_FLANK: Fp = fp(1);
/**
 * Смотрящие на линию наступления грани — не дальше стольких гексов от ближайшей к линии точки
 * фронта (07-controls.md, «Линия наступления»), гексов.
 */
export const OFFENSIVE_FACING_RANGE = 3;
/** Глубина линии наступления, которую строит commander по ▶, гексов (CR-006). */
export const COMMANDER_LINE_DEPTH = 3;
/** Автоделение на линии плана: часть не меньше шага набора (05-armies.md, CR-005). */
export const FRONT_SPLIT_MIN: Fp = fp(50);
/** Гекс линии угрожаем, если чужой отряд ближе стольких гексов. */
export const FRONT_THREAT_RANGE = 3;
/** Часть отряда у врага не меньше 1/FRONT_HOLD_DENOM силы врага рядом: автоделение не дробит силы. */
export const FRONT_HOLD_DENOM = 2;
export const FRONT_REALLOC_GAIN_MIN: Fp = fp(0.15);

// Обзор и победа

export const VISION_TERRITORY = 2;
export const VISION_UNIT = 3;
export const VISION_CITY = 3;
export const VICTORY_CITY_SHARE: Fp = fp(0.7);
export const VICTORY_HOLD_S: Fp = fp(60);
export const SCORE_CITY = 10;
export const SCORE_HEX = 1;
export const SCORE_PER_100_SOLDIERS = 1;
export const DISCONNECT_BOT_TAKEOVER_S: Fp = fp(30);
