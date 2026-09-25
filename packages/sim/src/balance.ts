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
export const OFFENSIVE_STEP_TICKS = 20;
export const BOT_THINK_TICKS = 10;
export const MATCH_TIME_LIMIT_S: Fp = fp(1500);
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
  plains: fp(0.12),
  forest: fp(0.15),
  hills: fp(0.15),
  mountains: fp(0.25),
  desert: fp(0.15),
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
export const NEUTRAL_CITIES_PER_PLAYER: Fp = fp(1.5);
/** Гарнизон нейтрального города по уровню 1/2/3, солдат. */
export const NEUTRAL_GARRISON: readonly [Fp, Fp, Fp] = [fp(150), fp(300), fp(600)];

// Население и налог

export const GROWTH_CITY_HEX: Fp = fp(3.0);
export const GROWTH_RING1: Fp = fp(1.5);
export const GROWTH_RING2: Fp = fp(0.5);
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
export const TAX_GROWTH_AT_40: Fp = fp(0.5);
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
export const NO_CITY_GRACE_S: Fp = fp(60);
/** Цена благоустройства уровней 1..3, золото. */
export const IMPROVEMENT_COST: readonly [Fp, Fp, Fp] = [fp(20), fp(40), fp(80)];
/** Время благоустройства уровней 1..3, секунд. */
export const IMPROVEMENT_TIME_S: readonly [Fp, Fp, Fp] = [fp(5), fp(8), fp(12)];
export const IMPROVEMENT_CAP_STEP: Fp = fp(0.5);
export const IMPROVEMENT_GROWTH_STEP: Fp = fp(0.3);
export const FORT_COST: Fp = fp(60);
export const FORT_TIME_S: Fp = fp(10);
export const FORT_DEF_MULT: Fp = fp(1.4);
export const DEPOT_COST: Fp = fp(80);
export const DEPOT_TIME_S: Fp = fp(15);
export const DEPOT_RADIUS = 3;
export const DEPOT_LOSS_MULT: Fp = fp(0.5);
export const ROAD_BUILD_S_PER_HEX: Fp = fp(1.5);
export const SUPPLY_REBUILD_COST_PER_HEX: Fp = fp(15);

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
export const ATK: ByUnit<Fp> = { infantry: fp(1.0), armor: fp(2.0), artillery: fp(0) };
export const DEF: ByUnit<Fp> = { infantry: fp(1.2), armor: fp(0.9), artillery: fp(0.6) };
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
  infantry: fp(1.0),
  armor: fp(2.5),
  artillery: fp(1.5),
};
export const RECRUIT_BASE_S: ByUnit<Fp> = { infantry: fp(8), armor: fp(15), artillery: fp(12) };
/** В таблице — `_PER_100_S` рядом с `RECRUIT_BASE_S`: секунд на каждые 100 солдат. */
export const RECRUIT_PER_100_S: ByUnit<Fp> = {
  infantry: fp(1),
  armor: fp(2),
  artillery: fp(1.5),
};

export const RECRUIT_MIN: Fp = fp(50);
export const RECRUIT_STEP: Fp = fp(50);
export const RECRUIT_MIN_HEX_POP_RATIO: Fp = fp(0.1);
export const MAX_UNITS_PER_HEX = 3;
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
export const ARTY_SUPPORT_BONUS: Fp = fp(1.3);
export const ARTY_SUPPORT_MIN_SOLDIERS: Fp = fp(100);
export const ARTY_FLEE_LOSS: Fp = fp(0.1);
export const FORECAST_MARGIN: Fp = fp(0.9);
export const OFFENSIVE_STOP_ORG: Fp = fp(30);
export const OFFENSIVE_ARROW_RADIUS = 3;
export const MAX_ACTIVE_ARROWS = 3;
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
