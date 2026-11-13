# GDD 10 — Баланс: все числа

**Единственный источник чисел.** `packages/sim/src/balance.ts` повторяет симуляционные разделы этой таблицы 1:1 (fixed-point: значение × 1000, где указано «FP»). Параметры генератора карт повторяются в `packages/mapgen/src/params.ts` и не входят в `sim/balance.ts`. Все числа `[ТЮНИНГ]`, меняются только здесь и в соответствующем зеркале одним коммитом (см. `CONVENTIONS.md`).

Единицы: время — секунды (в коде тики, 1 с = 10 тиков); проценты — доли (FP).

## Время

| Константа               | Значение       |
| ----------------------- | -------------- |
| `TICK_MS`               | 100            |
| `NETWORK_RECALC_TICKS`  | 10             |
| `VISION_RECALC_TICKS`   | 10             |
| `FRONT_ALLOC_TICKS`     | 50             |
| `FRONT_ROUTES_PER_TICK` | 16 `[ТЮНИНГ]`  |
| `OFFENSIVE_STEP_TICKS`  | 20             |
| `RETURN_LOCK_TICKS`     | 150 `[ТЮНИНГ]` |
| `OFFENSIVE_STUCK_TICKS` | 100            |
| `OFFENSIVE_STALL_TICKS` | 300 `[ТЮНИНГ]` |
| `OFFENSIVE_RETRY_TICKS` | 200 `[ТЮНИНГ]` |
| `COMMANDER_TICKS`       | 5              |
| `BOT_THINK_TICKS`       | 10             |
| `PREP_TIME_S`           | 5              |

## Боты

Веса бота — `bots/weights.json` и `bots/weights-easy.json` (включая порог и радиус слияния малых отрядов commander), подбирает `tools/evolve` (ADR 0010).

| Константа                    | Значение                |
| ---------------------------- | ----------------------- |
| `BOT_EASY_THINK_TICKS`       | 30 `[ТЮНИНГ]`           |
| `BOT_NORMAL_THINK_TICKS`     | 20 `[ТЮНИНГ]`           |
| `BOT_EASY_COMMANDER_EVERY`   | 3 `[ТЮНИНГ]`            |
| `BOT_NORMAL_COMMANDER_EVERY` | 2 `[ТЮНИНГ]`            |
| `BOT_WAR_GRACE_TICKS`        | 3000 (5 мин) `[ТЮНИНГ]` |
| `BOT_LINE_MAX_DEPTH`         | 6                       |
| `BOT_WAR_MIN_TICKS`          | 900 (90 с) `[ТЮНИНГ]`   |
| `BOT_WAR_WEARY_TICKS`        | 6000 (10 мин) `[ТЮНИНГ]` |
| `BOT_PEACE_LOCK_TICKS`       | 3000 (5 мин) `[ТЮНИНГ]` |
| `BOT_PACT_MIN_TICKS`         | 1800 (3 мин) `[ТЮНИНГ]` |
| `BOT_SPLIT_MIN_SOLDIERS`     | 600 `[ТЮНИНГ]`          |
| `BOT_BLOC_SHARE_DIVISOR`     | 3: блок альянса ботов ≤ ⌈живые / 3⌉, не меньше 2 `[ТЮНИНГ]` |
| `BOT_RESTLESS_START_TICKS`   | 3000 (5 мин покоя) `[ТЮНИНГ]` |
| `BOT_RESTLESS_RAMP_TICKS`    | 3000 (рост нетерпения до полного) `[ТЮНИНГ]` |

Профили сложности `BOT_PROFILES` `[ТЮНИНГ]` (09-bots.md, «Правки 2026-11-12»):

| Поле           | easy | normal | medium (сложный) |
| -------------- | ---- | ------ | ---------------- |
| `attackRatio`  | 1,8  | 1,2    | 1,0              |
| `holdRatio`    | 1,2  | 0,8    | 0,7              |
| `maxWars`      | 1    | 2      | 2                |
| `warEdge`      | 1,6  | 1,2    | 1,0              |
| `proposeEvery` | 1200 | 600    | 300              |
| `alarmPercent` | 0    | 40     | 28               |
| `coalitions`   | нет  | да     | да               |
| `opportunist`  | нет  | нет    | да               |
| `grudge`       | 0    | 150    | 250              |
| `maxArmies`    | 2    | 3      | 4                |
| `restless`     | 0    | 0,25   | 0,45             |

## Отношения игроков

| Константа            | Значение                                   |
| -------------------- | ------------------------------------------ |
| `ATTITUDE_MAX`       | 1000                                       |
| `ATT_WAR_ON_ME`      | 400                                        |
| `ATT_WAR_ON_FRIEND`  | 150                                        |
| `ATT_BREACH_PUBLIC`  | 100                                        |
| `ATT_CITY_LOST`      | 150                                        |
| `ATT_TREATY_GAIN`    | мир 40, пакт 120, оборона 200, альянс 300  |
| `ATT_PERIOD_TICKS`   | 50                                         |
| `ATT_PARTNER_GROWTH` | 2                                          |
| `ATT_PARTNER_CAP`    | 600                                        |

## Местность

| terrain   | `BASE_POP_CAP` | `MOVE_TIME_S` | `DEF_MULT` | `OFFROAD_SUPPLY_LOSS` |
| --------- | -------------- | ------------- | ---------- | --------------------- |
| plains    | 100            | 2,0           | 1,0        | 0,08                  |
| forest    | 60             | 3,0           | 1,25       | 0,10                  |
| hills     | 50             | 3,0           | 1,25       | 0,10                  |
| mountains | 25             | 5,0           | 1,6        | 0,17                  |
| desert    | 30             | 2,5           | 1,0        | 0,10                  |

| Константа                          | Значение                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `RIVER_MOVE_PENALTY_S`             | 1,0                                                                               |
| `RIVER_ATTACK_MULT`                | 0,7                                                                               |
| `ROAD_MOVE_MULT`                   | 0,5                                                                               |
| `DEPOT_SUPPLY`                     | 120 / 240 / 400 / 600 / 850 (уровни 1–5) `[ТЮНИНГ]`                               |
| `DEPOT_UPGRADE_COST` / `_TIME_S`   | 120 / 20 с (1→2); 220 / 30 с (2→3); 350 / 40 с (3→4); 520 / 50 с (4→5) `[ТЮНИНГ]` |
| `UNIT_SPEED_MULT`                  | 1,5 `[ТЮНИНГ]` (время шага отряда делится на множитель)                           |
| `ZOC_MOVE_MULT`                    | 2,0                                                                               |
| `FERTILE_CAP_MULT`                 | 1,5                                                                               |
| `MINE_GOLD_PER_S`                  | 1,0                                                                               |
| `CITY_MIN_DISTANCE`                | 4                                                                                 |
| `NEUTRAL_CITIES_PER_PLAYER`        | 1,5                                                                               |
| `NEUTRAL_GARRISON` по уровню 1/2/3 | 37 / 75 / 150 (четверть прежних значений, округление вниз)                        |

## Генератор карт

Параметры процедурного генератора карт зеркалируются в `packages/mapgen/src/params.ts`. Проценты — доли в процентах от указанной выборки; для количества на игрока используется округление вверх.

| Константа                   | Значение                        |
| --------------------------- | ------------------------------- |
| `MAPGEN_MAX_PLAYERS`        | 100 `[ТЮНИНГ]`                  |
| MAPGEN_NOISE_OCTAVES        | 3 `[ТЮНИНГ]`                    |
| MAPGEN_EDGE_WATER           | 2 гекса `[ТЮНИНГ]`              |
| MAPGEN_WATER_SHARE          | 15 % `[ТЮНИНГ]`                 |
| MAPGEN_MIN_ISLAND           | 30 гексов `[ТЮНИНГ]`            |
| MAPGEN_MOUNTAIN_SHARE       | 8 % суши `[ТЮНИНГ]`             |
| MAPGEN_HILLS_SHARE          | 14 % суши `[ТЮНИНГ]`            |
| MAPGEN_DESERT_SHARE         | 12 % оставшейся суши `[ТЮНИНГ]` |
| MAPGEN_FOREST_SHARE         | 24 % оставшейся суши `[ТЮНИНГ]` |
| MAPGEN_FERTILE_PER_PLAYER   | 0,5 `[ТЮНИНГ]`                  |
| MAPGEN_MINE_PER_PLAYER      | 0,34 `[ТЮНИНГ]`                 |
| MAPGEN_PASS_PER_MOUNTAINS   | 15 гексов гор `[ТЮНИНГ]`        |
| MAPGEN_RIVER_MIN_EDGES      | 5 рёбер `[ТЮНИНГ]`              |
| MAPGEN_RIVER_MAX_EDGES      | 40 рёбер `[ТЮНИНГ]`             |
| MAPGEN_RIVERS_PER_PLAYER    | 0,5 `[ТЮНИНГ]`                  |
| `PASSABLE_HEXES_PER_PLAYER` | 120 `[ТЮНИНГ]`                  |
| `EUROPE_MAP_MIN_LONGITUDE`  | −11° `[ТЮНИНГ]`                 |
| `EUROPE_MAP_MAX_LONGITUDE`  | 40° `[ТЮНИНГ]`                  |
| `EUROPE_MAP_MIN_LATITUDE`   | 35° `[ТЮНИНГ]`                  |
| `EUROPE_MAP_MAX_LATITUDE`   | 71° `[ТЮНИНГ]`                  |
| `EUROPE_MAP_TARGET_PLAYERS` | 30 `[ТЮНИНГ]`                   |

## Население и налог

| Константа                                          | Значение               |
| -------------------------------------------------- | ---------------------- |
| `GROWTH_CITY_HEX`                                  | 3,0 чел./с             |
| `GROWTH_RING1`                                     | 1,5                    |
| `GROWTH_RING2`                                     | 0,5                    |
| `GROWTH_BACKGROUND`                                | 0,4                    |
| `CITY_LEVEL_GROWTH_STEP`                           | 0,25                   |
| `POP_OVERCAP_DECAY`                                | 0,01 /с                |
| `CAPTURE_POP_LOSS_HEX`                             | 0,20                   |
| `CAPTURE_POP_LOSS_CITY`                            | 0,30                   |
| `TAX_MIN` / `TAX_MAX` / `TAX_STEP` / `TAX_DEFAULT` | 0 / 0,40 / 0,05 / 0,20 |
| `TAX_SLEW_PER_S`                                   | 0,02                   |
| `TAX_GROWTH_AT_0` / `_AT_20` / `_AT_40`            | 1,4 / 1,0 / 0,1        |
| `GOLD_PER_POP_TAX`                                 | 0,01                   |
| `ISOLATED_INCOME_MULT`                             | 0,5                    |
| `ISOLATED_SUPPLY_MULT`                             | 0,5                    |
| `ISOLATED_GROWTH_MULT`                             | 0,75                   |
| `BANKRUPT_SUPPLY_MULT`                             | 0,5                    |

## Города и постройки

| Константа                                                                                 | Значение                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `CITY_POP_CAP_PER_LEVEL`                                                                  | 300                                           |
| `CITY_SUPPLY_PER_LEVEL`                                                                   | 250                                           |
| `CAPITAL_SUPPLY_BONUS`                                                                    | 250                                           |
| `CITY_GOLD_PER_LEVEL`                                                                     | 0,5 /с                                        |
| `MILITIA_PER_LEVEL`                                                                       | 100                                           |
| `MILITIA_REGEN_PER_S`                                                                     | 4                                             |
| `CITY_DEF_MULT`                                                                           | 1,3                                           |
| `CITY_FOUND_BASE_COST`                                                                    | 120                                           |
| `CITY_FOUND_COST_STEP`                                                                    | 0,5                                           |
| `CITY_FOUND_MIN_POP_RATIO`                                                                | 0,6                                           |
| `CITY_FOUND_TIME_S`                                                                       | 30                                            |
| `CITY_UPGRADE_COST` L2..L5                                                                | 100 / 200 / 350 / 550                         |
| `CITY_UPGRADE_TIME_S` L2..L5                                                              | 20 / 30 / 40 / 50                             |
| `CAPTURED_OUTPUT_START`                                                                   | 0,25                                          |
| `CAPTURED_RAMP_S`                                                                         | 60                                            |
| `CAPITAL_MOVE_CHAOS_S`                                                                    | 30                                            |
| `CAPITAL_CHAOS_INCOME_MULT`                                                               | 0,5                                           |
| `NO_CITY_GRACE_S`                                                                         | 60                                            |
| `IMPROVEMENT_COST` L1..L3                                                                 | 20 / 40 / 80                                  |
| `IMPROVEMENT_TIME_S` L1..L3                                                               | 5 / 8 / 12                                    |
| `IMPROVEMENT_CAP_STEP`                                                                    | 0,5                                           |
| `IMPROVEMENT_GROWTH_STEP`                                                                 | 0,3                                           |
| `FORT_COST` / `FORT_TIME_S` / `FORT_DEF_MULT`                                             | 60 / 10 / 1,4                                 |
| `FORT_DEF_MULTS`                                                                          | 1,4 / 1,8 / 2,4 (уровни 1–3) `[ТЮНИНГ]`       |
| `FORT_UPGRADE_COST` / `_TIME_S`                                                           | 100 / 15 с (1→2); 200 / 20 с (2→3) `[ТЮНИНГ]` |
| `DEPOT_COST` / `DEPOT_TIME_S` / `DEPOT_RADIUS` / `DEPOT_MIN_DISTANCE` / `DEPOT_LOSS_MULT` | 80 / 15 / 3 / 3 / 0,5                         |
| `ROAD_BUILD_S_PER_HEX`                                                                    | 1,5                                           |
| `SUPPLY_REBUILD_COST_PER_HEX`                                                             | 15                                            |
| `ROAD_PATH_EXISTING_COST` (FP)                                                            | 0,01                                          |

## Армии

| Константа                                          | infantry              | armor                 | artillery             |
| -------------------------------------------------- | --------------------- | --------------------- | --------------------- |
| `COST_POP_PER_SOLDIER`                             | 1                     | 1                     | 1                     |
| `COST_GOLD_PER_SOLDIER`                            | 0,1                   | 1,0                   | 0,6                   |
| `UPKEEP_GOLD_PER_SOLDIER_S`                        | 0,003                 | 0,012                 | 0,008                 |
| `UPKEEP_GOLD_PER_UNIT_S` `[ТЮНИНГ]`                | 0,05                  | 0,05                  | 0,05                  |
| `ATK`                                              | 1,0                   | 2,0                   | 0                     |
| `DEF`                                              | 1,2                   | 0,9                   | 0,6                   |
| `SPEED` plains / forest,hills / mountains / desert | 1,0 / 0,7 / 0,5 / 0,9 | 1,6 / 0,8 / 0,5 / 1,4 | 0,7 / 0,5 / 0,4 / 0,7 |
| `SUPPLY_PER_SOLDIER`                               | 0,5                   | 1,25                  | 0,75                  |
| `RECRUIT_BASE_S` / `_PER_100_S`                    | 4 / 0,5               | 8 / 1                 | 6 / 0,75              |

| Константа                                                | Значение                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `XP_STAR_TICKS`                                          | 450 / 1800 / 4800 тиков боя до 1 / 2 / 3 звезды `[ТЮНИНГ]`                           |
| `STAR_POWER_PCT` / `STAR_ORG_PCT` / `STAR_REPLENISH_PCT` | 3 / 7 / 12 %; 3 / 7 / 12 %; 10 / 20 / 35 % — сила, организация, скорость восполнения |
| `ARMY_LEVEL_DENOMS`                                      | 16 / 8 / 4 / 2 / 1 (рота, батальон, полк, дивизия, корпус: доля предела государства) |
| `RECRUIT_MIN` / `RECRUIT_STEP`                           | 50 / 50                                                                              |
| `RECRUIT_MIN_HEX_POP_RATIO`                              | 0,1                                                                                  |
| `MAX_UNITS_PER_HEX`                                      | 1000 (предела нет)                                                                   |
| `START_UNITS`                                            | 2 × 100 пехоты                                                                       |
| `START_GOLD`                                             | 200                                                                                  |
| `START_POP_CAPITAL` / `START_POP_HEX`                    | 200 / 40                                                                             |
| `START_HEXES`                                            | 3 (столица + 2 соседних)                                                             |
| `NEUTRAL_HEX_POP_RATIO`                                  | 0,2                                                                                  |

## Снабжение и бой

| Константа                                          | Значение                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `SUPPLY_COMBAT_BASE`                               | 0,5 (mult = 0,5 + 0,5 × s)                                                                            |
| `ATTRITION_THRESHOLD`                              | 0,5                                                                                                   |
| `ATTRITION_GRACE_S`                                | 20                                                                                                    |
| `ATTRITION_MAX_PER_S`                              | 0,02                                                                                                  |
| `LOW_SUPPLY_SPEED_MULT`                            | 0,75                                                                                                  |
| `CASUALTY_RATE`                                    | 0,010                                                                                                 |
| `ORG_MAX`                                          | 100                                                                                                   |
| `ORG_LOSS_K` / `ORG_LOSS_MIN` / `ORG_LOSS_MAX`     | 6 / 1 / 20                                                                                            |
| `ORG_REGEN_PER_S`                                  | 4                                                                                                     |
| `ORG_AFTER_RETREAT`                                | 20                                                                                                    |
| `RETREAT_SOLDIER_LOSS`                             | 0,05                                                                                                  |
| `RETREAT_MOVE_MULT`                                | 0,7                                                                                                   |
| `RETREAT_DAMAGE_TAKEN_MULT`                        | 2,0                                                                                                   |
| `FLANK_STEP` / `FLANK_MAX`                         | 0,15 / 1,3                                                                                            |
| `ARTY_RANGE`                                       | 2                                                                                                     |
| `ARTY_DMG_PER_SOLDIER_S`                           | 0,004                                                                                                 |
| `ARTY_ORG_DMG_PER_SOLDIER_S`                       | 0,002                                                                                                 |
| `ARTY_POWER_MULT`                                  | 1,3                                                                                                   |
| `ARTY_SUPPORT_BONUS` / `ARTY_SUPPORT_MIN_SOLDIERS` | 1,3 / 100                                                                                             |
| `ARTY_FLEE_LOSS`                                   | 0,10                                                                                                  |
| `FORECAST_MARGIN`                                  | 0,9                                                                                                   |
| `OFFENSIVE_STOP_ORG`                               | 30                                                                                                    |
| `MAX_ACTIVE_ARROWS`                                | 3                                                                                                     |
| `OFFENSIVE_FACING_WEIGHT`                          | 3                                                                                                     |
| `FRONT_WEIGHT_CITY`                                | 2 `[ТЮНИНГ]`                                                                                          |
| `FRONT_WEIGHT_CAPITAL`                             | 3 `[ТЮНИНГ]`                                                                                          |
| `FRONT_WEIGHT_DEPOT`                               | 1 `[ТЮНИНГ]`                                                                                          |
| `FRONT_WEIGHT_FLANK`                               | 1 `[ТЮНИНГ]`                                                                                          |
| `FRONT_REBALANCE_SURPLUS`                          | 2 `[ТЮНИНГ]`                                                                                          |
| `OFFENSIVE_ECHELON_PERIOD`                         | 2 `[ТЮНИНГ]`                                                                                          |
| `OFFENSIVE_STACK`                                  | 2 `[ТЮНИНГ]`                                                                                          |
| `PORT_CAPACITY_PER_LEVEL`                          | 600 солдат `[ТЮНИНГ]`                                                                                 |
| `SEA_MAX_HEXES`                                    | 40 `[ТЮНИНГ]`                                                                                         |
| `SEA_MOVE_S_PER_HEX`                               | 0,8 с `[ТЮНИНГ]`                                                                                      |
| `SEA_COST_PER_SOLDIER_HEX`                         | 0,02 золота `[ТЮНИНГ]`                                                                                |
| `PROCURE_BATCH`                                    | 1000 `[ТЮНИНГ]`                                                                                       |
| `PROCURE_CITIES`                                   | 6 `[ТЮНИНГ]`                                                                                          |
| `UNIT_SPLIT_SOLDIERS`                              | 300 `[ТЮНИНГ]`                                                                                        |
| `POCKET_MAX_LAND`                                  | 60 `[ТЮНИНГ]`                                                                                         |
| `EXPAND_RADIUS_BASE`                               | 3 `[ТЮНИНГ]`                                                                                          |
| `EXPAND_SOLDIERS_PER_HEX`                          | 100 `[ТЮНИНГ]`                                                                                        |
| `EXPAND_RADIUS_MAX`                                | 10 `[ТЮНИНГ]`                                                                                         |
| `EXPAND_MOUNTAIN_PENALTY`                          | 8 `[ТЮНИНГ]`                                                                                          |
| `EXPAND_PULL_RANGE`                                | 6 `[ТЮНИНГ]`                                                                                          |
| `EXPAND_STORM_GAP`                                 | 2 `[ТЮНИНГ]`                                                                                          |
| `EXPAND_COMPACT_WEIGHT`                            | 3 `[ТЮНИНГ]`                                                                                          |
| `AID_TTL_TICKS`                                    | 300 (запрос помощи оборонительного пакта, 30 с) `[ДИЗАЙН-РЕШЕНИЕ 2026-11-10]`                         |
| `AID_RETURN_TICKS`                                 | 600 (после войны помощника проход открыт, пока отряды идут домой, 60 с) `[ДИЗАЙН-РЕШЕНИЕ 2026-11-10]` |
| `RESULT_TTL_TICKS` | 300 (итог голосования висит в интерфейсе, 30 с) `[ДИЗАЙН-РЕШЕНИЕ 2026-11-10]` |
| `BOT_VOTE_DELAY_TICKS` | 30 (бот отвечает в голосовании не раньше, плюс разброс до 30) `[ДИЗАЙН-РЕШЕНИЕ 2026-11-10]` |
| `VOTE_TTL_TICKS`                                   | 600 (голосование альянса, 60 с) `[ДИЗАЙН-РЕШЕНИЕ 2026-11-10]`                                         |
| `MERGE_SMALL_TINY`                                 | 25 `[ТЮНИНГ]`                                                                                         |
| `MERGE_SMALL_BELOW`                                | 150 `[ТЮНИНГ]`                                                                                        |
| `CONSOLIDATE_CROWD`                                | 12 `[ТЮНИНГ]`                                                                                         |
| `MERGE_SMALL_RADIUS`                               | 4 `[ТЮНИНГ]`                                                                                          |
| `CONSOLIDATE_MAX`                                  | 300 `[ТЮНИНГ]`                                                                                        |
| `CONSOLIDATE_UNITS_TARGET`                         | 25 `[ТЮНИНГ]`                                                                                         |
| `CONSOLIDATE_MAX_CEIL`                             | 1500 `[ТЮНИНГ]`                                                                                       |
| `CONSOLIDATE_SAFE`                                 | 3 `[ТЮНИНГ]`                                                                                          |
| `CONSOLIDATE_PERIOD_S`                             | 2 `[ТЮНИНГ]`                                                                                          |
| `SWARM_SAFE`                                       | 6 `[ТЮНИНГ]`                                                                                          |
| `AXIS_SOLDIERS`                                    | 300 `[ТЮНИНГ]`                                                                                        |
| `AXIS_MAX`                                         | 8 `[ТЮНИНГ]`                                                                                          |
| `AXIS_REFRESH_S`                                   | 5 `[ТЮНИНГ]`                                                                                          |
| `AXIS_DONE_PERCENT`                                | 70 `[ТЮНИНГ]`                                                                                         |
| `BOT_AXIS_EDGES`                                   | 14 `[ТЮНИНГ]`                                                                                         |
| `ASSAULT_REACH`                                    | 10 `[ТЮНИНГ]`                                                                                         |
| `ASSAULT_MAX_UNITS`                                | 8 `[ТЮНИНГ]`                                                                                          |
| `ASSAULT_PERIOD_S`                                 | 2 `[ТЮНИНГ]`                                                                                          |
| `OFFENSIVE_FACING_RANGE`                           | 3                                                                                                     |
| `COMMANDER_LINE_DEPTH`                             | 3                                                                                                     |
| `FRONT_SPLIT_MIN`                                  | 50                                                                                                    |
| `FRONT_HOLD_DENOM`                                 | 2 `[ТЮНИНГ]`                                                                                          |
| `FRONT_THREAT_RANGE`                               | 3 `[ТЮНИНГ]`                                                                                          |
| `FRONT_REALLOC_GAIN_MIN`                           | 0,15                                                                                                  |

## Обзор и победа

| Константа                                             | Значение   |
| ----------------------------------------------------- | ---------- |
| `VISION_TERRITORY` / `_UNIT` / `_CITY`                | 2 / 3 / 3  |
| `VICTORY_CITY_SHARE`                                  | 0,70       |
| `VICTORY_HOLD_S`                                      | 60         |
| `SCORE_CITY` / `SCORE_HEX` / `SCORE_PER_100_SOLDIERS` | 10 / 1 / 1 |
| `DISCONNECT_BOT_TAKEOVER_S`                           | 30         |
