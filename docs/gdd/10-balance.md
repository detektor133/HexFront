# GDD 10 — Баланс: все числа

**Единственный источник чисел.** `packages/sim/src/balance.ts` повторяет эту таблицу 1:1 (fixed-point: значение × 1000, где указано «FP»). Все числа `[ТЮНИНГ]`, меняются только здесь и в `balance.ts` одним коммитом `balance(sim): ...` (см. `CONVENTIONS.md`).

Единицы: время — секунды (в коде тики, 1 с = 10 тиков); проценты — доли (FP).

## Время

| Константа | Значение |
| --- | --- |
| `TICK_MS` | 100 |
| `NETWORK_RECALC_TICKS` | 10 |
| `VISION_RECALC_TICKS` | 10 |
| `FRONT_ALLOC_TICKS` | 50 |
| `OFFENSIVE_STEP_TICKS` | 20 |
| `BOT_THINK_TICKS` | 10 |
| `MATCH_TIME_LIMIT_S` | 1500 |
| `PREP_TIME_S` | 5 |

## Местность

| terrain | `BASE_POP_CAP` | `MOVE_TIME_S` | `DEF_MULT` | `OFFROAD_SUPPLY_LOSS` |
| --- | --- | --- | --- | --- |
| plains | 100 | 2,0 | 1,0 | 0,12 |
| forest | 60 | 3,0 | 1,25 | 0,15 |
| hills | 50 | 3,0 | 1,25 | 0,15 |
| mountains | 25 | 5,0 | 1,6 | 0,25 |
| desert | 30 | 2,5 | 1,0 | 0,15 |

| Константа | Значение |
| --- | --- |
| `RIVER_MOVE_PENALTY_S` | 1,0 |
| `RIVER_ATTACK_MULT` | 0,7 |
| `ROAD_MOVE_MULT` | 0,5 |
| `ZOC_MOVE_MULT` | 2,0 |
| `FERTILE_CAP_MULT` | 1,5 |
| `MINE_GOLD_PER_S` | 1,0 |
| `CITY_MIN_DISTANCE` | 4 |
| `PASSABLE_HEXES_PER_PLAYER` | 120 |
| `NEUTRAL_CITIES_PER_PLAYER` | 1,5 |
| `NEUTRAL_GARRISON` по уровню 1/2/3 | 150 / 300 / 600 |

## Население и налог

| Константа | Значение |
| --- | --- |
| `GROWTH_CITY_HEX` | 3,0 чел./с |
| `GROWTH_RING1` | 1,5 |
| `GROWTH_RING2` | 0,5 |
| `GROWTH_BACKGROUND` | 0,4 |
| `CITY_LEVEL_GROWTH_STEP` | 0,25 |
| `POP_OVERCAP_DECAY` | 0,01 /с |
| `CAPTURE_POP_LOSS_HEX` | 0,20 |
| `CAPTURE_POP_LOSS_CITY` | 0,30 |
| `TAX_MIN` / `TAX_MAX` / `TAX_STEP` / `TAX_DEFAULT` | 0 / 0,40 / 0,05 / 0,20 |
| `TAX_SLEW_PER_S` | 0,02 |
| `TAX_GROWTH_AT_0` / `_AT_20` / `_AT_40` | 1,4 / 1,0 / 0,5 |
| `GOLD_PER_POP_TAX` | 0,01 |
| `ISOLATED_INCOME_MULT` | 0,5 |
| `ISOLATED_SUPPLY_MULT` | 0,5 |
| `ISOLATED_GROWTH_MULT` | 0,75 |
| `BANKRUPT_SUPPLY_MULT` | 0,5 |

## Города и постройки

| Константа | Значение |
| --- | --- |
| `CITY_POP_CAP_PER_LEVEL` | 300 |
| `CITY_SUPPLY_PER_LEVEL` | 250 |
| `CAPITAL_SUPPLY_BONUS` | 250 |
| `CITY_GOLD_PER_LEVEL` | 0,5 /с |
| `MILITIA_PER_LEVEL` | 100 |
| `MILITIA_REGEN_PER_S` | 4 |
| `CITY_DEF_MULT` | 1,3 |
| `CITY_FOUND_BASE_COST` | 120 |
| `CITY_FOUND_COST_STEP` | 0,5 |
| `CITY_FOUND_MIN_POP_RATIO` | 0,6 |
| `CITY_FOUND_TIME_S` | 30 |
| `CITY_UPGRADE_COST` L2..L5 | 100 / 200 / 350 / 550 |
| `CITY_UPGRADE_TIME_S` L2..L5 | 20 / 30 / 40 / 50 |
| `CAPTURED_OUTPUT_START` | 0,25 |
| `CAPTURED_RAMP_S` | 60 |
| `CAPITAL_MOVE_CHAOS_S` | 30 |
| `CAPITAL_CHAOS_INCOME_MULT` | 0,5 |
| `NO_CITY_GRACE_S` | 60 |
| `IMPROVEMENT_COST` L1..L3 | 20 / 40 / 80 |
| `IMPROVEMENT_TIME_S` L1..L3 | 5 / 8 / 12 |
| `IMPROVEMENT_CAP_STEP` | 0,5 |
| `IMPROVEMENT_GROWTH_STEP` | 0,3 |
| `FORT_COST` / `FORT_TIME_S` / `FORT_DEF_MULT` | 60 / 10 / 1,4 |
| `DEPOT_COST` / `DEPOT_TIME_S` / `DEPOT_RADIUS` / `DEPOT_LOSS_MULT` | 80 / 15 / 3 / 0,5 |
| `ROAD_BUILD_S_PER_HEX` | 1,5 |
| `SUPPLY_REBUILD_COST_PER_HEX` | 15 |

## Армии

| Константа | infantry | armor | artillery |
| --- | --- | --- | --- |
| `COST_POP_PER_SOLDIER` | 1 | 1 | 1 |
| `COST_GOLD_PER_SOLDIER` | 0,1 | 1,0 | 0,6 |
| `UPKEEP_GOLD_PER_SOLDIER_S` | 0,003 | 0,012 | 0,008 |
| `ATK` | 1,0 | 2,0 | 0 |
| `DEF` | 1,2 | 0,9 | 0,6 |
| `SPEED` plains / forest,hills / mountains / desert | 1,0 / 0,7 / 0,5 / 0,9 | 1,6 / 0,8 / 0,5 / 1,4 | 0,7 / 0,5 / 0,4 / 0,7 |
| `SUPPLY_PER_SOLDIER` | 1,0 | 2,5 | 1,5 |
| `RECRUIT_BASE_S` / `_PER_100_S` | 8 / 1 | 15 / 2 | 12 / 1,5 |

| Константа | Значение |
| --- | --- |
| `RECRUIT_MIN` / `RECRUIT_STEP` | 50 / 50 |
| `RECRUIT_MIN_HEX_POP_RATIO` | 0,1 |
| `MAX_UNITS_PER_HEX` | 3 |
| `UNIT_LIMIT_BASE` / `_PER_CITY` | 4 / 2 |
| `START_UNITS` | 2 × 100 пехоты |
| `START_GOLD` | 200 |
| `START_POP_CAPITAL` / `START_POP_HEX` | 200 / 40 |
| `START_HEXES` | 3 (столица + 2 соседних) |
| `NEUTRAL_HEX_POP_RATIO` | 0,2 |

## Снабжение и бой

| Константа | Значение |
| --- | --- |
| `SUPPLY_COMBAT_BASE` | 0,5 (mult = 0,5 + 0,5 × s) |
| `ATTRITION_THRESHOLD` | 0,5 |
| `ATTRITION_GRACE_S` | 20 |
| `ATTRITION_MAX_PER_S` | 0,02 |
| `LOW_SUPPLY_SPEED_MULT` | 0,75 |
| `CASUALTY_RATE` | 0,010 |
| `ORG_MAX` | 100 |
| `ORG_LOSS_K` / `ORG_LOSS_MIN` / `ORG_LOSS_MAX` | 6 / 1 / 20 |
| `ORG_REGEN_PER_S` | 4 |
| `ORG_AFTER_RETREAT` | 20 |
| `RETREAT_SOLDIER_LOSS` | 0,05 |
| `RETREAT_MOVE_MULT` | 0,7 |
| `RETREAT_DAMAGE_TAKEN_MULT` | 2,0 |
| `FLANK_STEP` / `FLANK_MAX` | 0,15 / 1,3 |
| `ARTY_RANGE` | 2 |
| `ARTY_DMG_PER_SOLDIER_S` | 0,004 |
| `ARTY_ORG_DMG_PER_SOLDIER_S` | 0,002 |
| `ARTY_SUPPORT_BONUS` / `ARTY_SUPPORT_MIN_SOLDIERS` | 1,3 / 100 |
| `ARTY_FLEE_LOSS` | 0,10 |
| `FORECAST_MARGIN` | 0,9 |
| `OFFENSIVE_STOP_ORG` | 30 |
| `MAX_ACTIVE_ARROWS` | 3 |
| `FRONT_REALLOC_GAIN_MIN` | 0,15 |

## Обзор и победа

| Константа | Значение |
| --- | --- |
| `VISION_TERRITORY` / `_UNIT` / `_CITY` | 2 / 3 / 3 |
| `VICTORY_CITY_SHARE` | 0,70 |
| `VICTORY_HOLD_S` | 60 |
| `SCORE_CITY` / `SCORE_HEX` / `SCORE_PER_100_SOLDIERS` | 10 / 1 / 1 |
| `DISCONNECT_BOT_TAKEOVER_S` | 30 |
