# Этап 06 — Боты и баланс

**Цель:** матчи с ботами заканчиваются до 25:00 в темпе `gdd/00-overview.md`, «Темп матча» (CR-008).

**Читать:** `gdd/09-bots.md`, `gdd/10-balance.md`, `gdd/00-overview.md`, `architecture/sim-core.md`.

## Задачи

- [ ] **T1. Боты на обучаемых весах** (`gdd/09-bots.md`, «Utility AI»), не задача владельца. Переделка мозга и пути ботов в commander. Критерии 04/T26d: победа захватом или выбывание до 25:00; золото выше 5 000 не дольше 2 минут; отряд меньше 10 солдат не дольше 30 секунд. Исходные замеры — `reports/stage-05.md`, 05/T8. Запреты: `playerView` и проход по всей карте в решении бота; `Math.random` и float в `sim`; изменение команд commander без ботов и golden-хэшей. Из сохраняемых проверок старой цепочки остаются easy и автопополнение. Приёмка T1 прежняя.
  *Приёмка (`$accept 06/T1`):* один раз `pnpm report:match --seeds 3` (`small`, 6 ботов, сиды 42–44) — все три критерия. Бюджет полного тика проверяет T1e.
- [—] **T1a. Ручные коэффициенты и пороги CR-008** — заменена T1f/T1g, решение 2026-10-09.
- [x] **T1b. Снимок бота** (`bots/snapshot.ts`, подсистема бот, запреты T1 действуют).
  *Приёмка:* числа снимка (контакты `mine`/`theirs`, золото, доход, содержание, свободные города) равны расчёту через `playerView` на 3 сценариях и `gen` 30 игроков на тиках 600 и 3000; вражеские отряды вне обзора не меняют снимок; в коде снимка нет `playerView` и прохода по всей `hexes.owner`.
- [—] **T1c. Мозг бота на ручных целях** — заменена T1g, решение 2026-10-09.
- [x] **T1d. Путь ботов в commander** (`bots/commander.ts`, `run.ts`; подсистема бот, запреты T1 действуют).
  *Приёмка:* отряд меньше `BOT_MERGE_BELOW` слит не дольше 30 с при однотипном отряде армии в радиусе; резерв уходит в армию цели; `commanderCommands` без ботов даёт прежние команды, golden-хэши не меняются; минутный замер commander ≤ 0,348 мс/бот/ход.
- [—] **T1e4. Проверка родителя T1**, заменена новой T1e, решение 2026-10-09.

- [x] **T1e1. Детерминизм прогона T1e**, подсистема тестов.
  *Приёмка:* Vitest-тест выполняет два прогона по 1200 тиков для 6 ботов на `small` и подтверждает одинаковые хэши состояния и команды.

- [x] **T1e2. Бюджет полного тика T1e**, подсистема benchmark.
  *Приёмка:* один запуск `pnpm --filter @hexfront/bench full-match --players=30 --minutes=5` подтверждает полный тик не более 15 мс на минутах 1–5.

- [x] **T1e3. Удаление старой цепочки экономики**, подсистема ботов.
  *Приёмка:* старый `economy.ts` удалён, ссылки на мёртвый код отсутствуют; сохранены тесты проверок easy и автопополнения.

- [x] **T1f. Каталог действий и признаки** (`bots/actions.ts`, `bots/features.ts`, `BUILDING_DEFS` в `balance.ts` из существующих констант; подсистема бот). Запреты T1 действуют.
  *Приёмка:* каталог — функция от определений; тест подаёт фиктивный тип юнита и фиктивную постройку, оба появляются в каталоге без изменения кода бота; табличные тесты подтверждают эффекты и контексты из `09-bots.md` в fixed-point; в коде каталога и признаков нет `playerView` и прохода по всей карте.

- [x] **T1g. Мозг на весах** (`bots/brain.ts`, `bots/weights.json`; подсистема бот). Запреты T1 действуют.
  *Приёмка:* табличные тесты подтверждают `Σ вес × признак`, изменение веса меняет выбор, траты идут до `BOT_GOLD_RESERVE`, одно действие выполняется на город или гекс, порядок при равенстве стабилен; ▶/■ только для своих армий, easy без ▶ и с `BOT_EASY_TAX`; `goals.ts`, его тест и удалённые константы удалены, мёртвого кода нет, golden commander не меняются; полный тик 30 ботов ≤ 15 мс, экономика ≤ 0,508 мс/бот/ход.

- [x] **T1ga. Весовая оценка мозга** (`bots/brain.ts`, `bots/weights.json`; подсистема бот). Запреты T1 действуют.
  *Приёмка:* табличные тесты подтверждают `Σ вес × признак`; изменение веса меняет выбор; порядок при равенстве стабилен. Зависит от каталога действий и признаков `T1f`.
  *Запреты:* `playerView` и проход по всей карте в решении бота; `Math.random` и float в `sim`; изменение команд commander без ботов и golden-хэшей. Из сохраняемых проверок старой цепочки остаются easy и автопополнение.

- [x] **T1gb. Траты и ограничение действий** (`bots/brain.ts`; подсистема бот). Запреты T1 действуют.
  *Приёмка:* траты идут до `BOT_GOLD_RESERVE`; одно действие выполняется на город или гекс. Зависит от каталога действий `T1f` и весовой оценки `T1ga`.
  *Запреты:* `playerView` и проход по всей карте в решении бота; `Math.random` и float в `sim`; изменение команд commander без ботов и golden-хэшей. Из сохраняемых проверок старой цепочки остаются easy и автопополнение.

- [x] **T1gc. Ограничения армий и easy** (`bots/brain.ts`; подсистема бот). Запреты T1 действуют.
  *Приёмка:* ▶/■ создаются только для своих армий; easy работает без ▶ и с `BOT_EASY_TAX`. Зависит от командного слоя `T1gb` и сохранённого пути commander `T1d`.
  *Запреты:* `playerView` и проход по всей карте в решении бота; `Math.random` и float в `sim`; изменение команд commander без ботов и golden-хэшей. Из сохраняемых проверок старой цепочки остаются easy и автопополнение.

- [x] **T1gd. Удаление старого мозга и бюджет** (`bots/brain.ts`, `bots/goals.ts`, `bots/weights.json`; подсистема бот). Запреты T1 действуют.
  *Приёмка:* `goals.ts`, его тест и удалённые константы удалены; мёртвого кода нет; golden commander не меняются; полный тик 30 ботов ≤ 15 мс и экономика ≤ 0,508 мс/бот/ход. Выполнить минутный замер `pnpm --filter @hexfront/bench full-match --players=30,100 --minutes=1` и сравнить с базой.
  *Запреты:* `playerView` и проход по всей карте в решении бота; `Math.random` и float в `sim`; изменение команд commander без ботов и golden-хэшей. Из сохраняемых проверок старой цепочки остаются easy и автопополнение.

- [x] **T1ge. Проверка родителя T1g** (сквозная проверка, подсистема бот). Запреты T1 действуют.
  *Приёмка:* сверить все строки трассировки T1g с тестами T1ga–T1gd; повторно подтвердить отсутствие `goals.ts` и мёртвого кода, неизменность golden commander и оба бюджетных замера; только после этого отметить T1g `[x]`. Зависит от T1ga–T1gd.
  *Запреты:* `playerView` и проход по всей карте в решении бота; `Math.random` и float в `sim`; изменение команд commander без ботов и golden-хэшей. Из сохраняемых проверок старой цепочки остаются easy и автопополнение.

- [x] **T1h. `tools/evolve`** (подсистема инструменты, без новых зависимостей; команда `pnpm evolve`). Запреты T1 действуют.
  *Приёмка:* реализована (μ,λ)-ES с целочисленными весами, seeded RNG, worker_threads и параметрами `--population`, `--seeds`, `--generations`, `--workers`, `--resume`; короткий Vitest-прогон на 300 тиках даёт одинаковый `weights.json` при 1 и 4 worker_threads; после поколения сохраняются `weights.json`, состояние resume и отчёт `docs/reports/evolve/`; полный `pnpm evolve` в задаче не запускается.

- [ ] **T1j. Доделка обучаемых весов** (решение 2026-10-09), не задача владельца. Цель: новая механика, юнит или постройка подхватывается ботом без правки кода бота, а всё, что решает бот, — обучаемые веса, а не ручные числа. Запреты T1 действуют в каждой подзадаче. Дополнительные запреты T1j, тоже в каждой подзадаче:
  - новых констант BOT_* и чисел, которых нет в тексте T1j или в 10-balance.md, не вводить; нужен новый — вопрос в QUESTIONS.md и стоп;
  - в packages/sim/src/bots/brain.ts, actions.ts, features.ts нет: строковых литералов видов команд ('recruit', 'build', 'upgradeCity', 'improve', 'foundCity', 'rebuildSupply', 'setTax', 'startOffensive', 'stopOffensive'), типов юнитов ('infantry', 'armor', 'artillery') и построек ('fort', 'depot'); импорта balance.ts; порогов решения, кроме сравнения оценки с 0;
  - после T1j у ботов остаются только числа, которые не решают «что делать»: BOT_THINK_TICKS и BOT_EASY_THINK_TICKS (как часто бот думает) и BOT_LINE_MAX_DEPTH (предел вычислений линии наступления);
  - тесты мозга и commander передают свои веса явно; от weights.json и weights-easy.json зависит только тест их формата. Существующие тесты мозга, которые берут веса по умолчанию, разрешено дополнить явными весами, не меняя их проверок (expect);
  - владелец разрешает заменить новыми тестами T1j только эти тесты, другие чужие тесты не ослаблять:
    · packages/sim/test/bot-brain-regressions.test.ts:40-51 (налог мира и налог войны);
    · packages/sim/test/bot-brain-regressions.test.ts:71-93 (easy-налог 20 % и резерв золота);
    · packages/sim/test/bot-brain.test.ts:26 («не превышает BOT_MAX_SPENDS»);
    · packages/sim/test/bot-brain.test.ts:45 («запускает и останавливает наступление по отношению сил»);
    · packages/sim/test/bot-brain.test.ts:75 и :105 (easy-налог и easy без ▶/■);
    · packages/sim/test/bot-actions-features.test.ts:71 (старые эффекты и признаки);
    · tools/evolve/src/index.test.ts:10 (разбор параметров и --resume с путём).
  *Приёмка:* T1j1–T1j6 отмечены [x].

- [x] **T1j1. Варианты команд с эффектами** (реестр packages/sim/src/bots/options/index.ts; варианты и эффекты каждого вида команды — в своём файле packages/sim/src/bots/options/<вид>.ts, например recruit.ts, build.ts, city.ts, rebuild-supply.ts, tax.ts, offensive.ts; BUILDING_DEFS в balance.ts; экспорт incomePerSecond из systems/economy.ts без изменения формулы; всё это — подсистема бот). Запреты T1 и T1j действуют. Приёмка:
  1) Реестр COMMAND_OPTIONS — список записей { kind, options(state, playerId, context, definitions) → варианты }. Вариант — { command, group, effects }, где effects — Record<string, Fp>: изменение показателя игрока относительно его текущего значения (доля, fixed-point), знаменатели: cost — золото игрока; upkeep — его содержание/с; income — его доход/с; strength, defense, supply — его сила Σ солдаты × (ATK + DEF) по context.unitsByPlayer; growth, frontRatio, enemyCities, activeOffensive — уже доли; знаменатель 0 → эффект 0. Новая механика добавляется новым файлом в bots/options и одной строкой регистрации в реестре; мозг (brain.ts, actions.ts, features.ts) при этом не меняется. Файлы bots/options импортируют только sim (commands, state, systems, balance) и тип контекста бота; циклических импортов нет (dependency-cruiser). definitions по умолчанию — таблицы balance.ts.
  2) Варианты, все — только допустимые по существующим check-функциям (checkRecruit, checkConstruction, rebuildSupplyPlan, validateSetTax, validatePlanCommand):
     - recruit — каждый свой свободный город × каждый тип юнита из ключей таблиц ByUnit; солдат — наибольшее число по золоту игрока и recruitCapacity, вниз до шага RECRUIT_STEP, не меньше RECRUIT_MIN; group — город;
     - build — свои граничные гексы (context.borderHexes) и гексы своих городов × ключи BUILDING_DEFS; group — гекс;
     - upgradeCity — свои города; improve и foundCity — свои гексы (context.ownedHexes); group — гекс;
     - rebuildSupply — свои изолированные города; group — город;
     - setTax — ставки TAX_MIN…TAX_MAX шагом TAX_STEP, кроме taxTarget; group — налог;
     - startOffensive — своя армия с фронтом у врага без активного наступления; stopOffensive — с активным; group — армия.
  3) Эффекты — функциями sim, без копирования формул. Табличный тест на сценарии с 2 своими городами (один изолирован), своими солдатами на граничном гексе и контактом с врагом: у каждого вида хотя бы один эффект ≠ 0.
     - recruit N солдат типа T: cost; upkeep = N × UPKEEP_GOLD_PER_SOLDIER_S + UPKEEP_GOLD_PER_UNIT_S типа; strength = N × (ATK + DEF); supply = −N × SUPPLY_PER_SOLDIER.
     - build K на гексе H: cost; defense = (defenseMult − 1) × свои солдаты на H; supply = (1 − supplyLossMult) × свои солдаты на гексах в радиусе supplyRadius от H (context.unitsByHex). В BUILDING_DEFS добавляется supplyRadius: fort — 0, depot — DEPOT_RADIUS; тип команды build — `keyof typeof BUILDING_DEFS`.
     - upgradeCity: cost; income = cityGold на уровне +1 − cityGold сейчас (state/city-output.ts) + incomePerSecond(cityPopCap(уровень+1) − cityPopCap(уровень), taxTarget, 0).
     - improve на H: cost; income = incomePerSecond(hexPopCap с improvement+1 − hexPopCap сейчас, taxTarget, 0).
     - foundCity на H: cost; income = CITY_GOLD_PER_LEVEL + incomePerSecond(cityPopCap(1) − hexPopCap(H), taxTarget, 0).
     - rebuildSupply города C: cost; income = cityGold(C) / ISOLATED_INCOME_MULT − cityGold(C) (fpDiv).
     - setTax: income = playerIncomePerSecond(state, id, ставка, context.incomeBases) − то же при taxTarget; growth = taxGrowthMult(ставка) − taxGrowthMult(taxTarget) (systems/tax.ts).
     - startOffensive и stopOffensive: frontRatio = mine / (mine + theirs) контакта с врагом этого фронта; enemyCities = 1 / (1 + число городов этого врага по context.citiesByPlayer); activeOffensive = 1 у stopOffensive, 0 у startOffensive.
  4) Тест расширяемости реестра: definitions с фиктивным типом юнита (ATK больше всех) и фиктивной постройкой дают их варианты и эффекты без изменения кода bots/options и мозга.

- [x] **T1j2. Мозг без знания команд** (bots/brain.ts, bots/actions.ts, bots/features.ts; подсистема бот). Запреты T1 и T1j действуют. Приёмка:
  1) Экспортируемая planBotActions(state, playerId, context, weights, options = COMMAND_OPTIONS) — единственный путь, которым brainDecide строит, оценивает и выбирает команды; brainDecide возвращает ровно её команды (тест).
  2) Признаки строятся из ключей effects автоматически, списка эффектов в боте нет. Контексты из снимка: threat — max по врагам theirs / (mine + theirs); goldSeconds — золото / доход (0 при доходе 0); neutralBorderShare — доля своих граничных гексов с соседом без владельца. Признаки варианта: каждый контекст; каждый эффект k; k × каждый контекст. Имя признака — `k`, `k*threat`, `k*goldSeconds`, `k*neutralBorderShare`, `threat`, `goldSeconds`, `neutralBorderShare`. Признака нет в весах — его вес 0. Оценка = Σ вес × признак, целые числа. Табличный тест на каждый вид признака.
  3) Выбор: в каждой group — один вариант с наибольшей оценкой > 0 (при равенстве — порядок реестра, затем порядок вариантов). Выбранные варианты исполняются по убыванию оценки; вариант с cost > 0 — пока золото ≥ его цены. Лимита числа действий нет.
  4) Интеграционный тест: реестр, дополненный в тесте фиктивной записью с эффектом { testEffect: 1000 }, и definitions с фиктивным типом юнита — при весах testEffect > 0 и strength*threat > 0 и угрозе > 0 бот выбирает фиктивные варианты без изменения кода бота. Тест-страж читает исходники brain.ts, actions.ts, features.ts и падает на запрещённых литералах и импорте balance.ts (запрет T1j).

  Возврат ревью: пункт 4 не подтверждён — `bot-brain-dynamic.test.ts` не передаёт фиктивные definitions с новым типом юнита, не создаёт угрозу > 0 и не проверяет `strength*threat`; тест-страж, читающий `brain.ts`, `actions.ts`, `features.ts` на запрещённые литералы и импорт `balance.ts`, отсутствует.

- [ ] **T1j3. Веса по игроку, уровни и удаление констант мозга** (bots/brain.ts, bots/run.ts, bots/weights.json, bots/weights-easy.json, balance.ts; подсистема бот). Запреты T1 и T1j действуют. Приёмка:
  1) brainDecide и botCommands принимают веса по id игрока (массив); по умолчанию medium — weights.json, easy — weights-easy.json. Тест: два бота с разными весами в одном тике выбирают каждый по своим. Тест на явных весах: изменение одного веса меняет выбранную ставку налога, и изменение одного веса меняет решение ▶.
  2) Уровни различаются только весами и частотой решения: easy — weights-easy.json и раз в BOT_EASY_THINK_TICKS; отдельных правил easy (налог, запрет ▶/■) нет.
  3) Удалить из balance.ts и всего packages/sim/src: BOT_TAX_PEACE, BOT_TAX_WAR, BOT_ATTACK_MIN_RATIO, BOT_ATTACK_STOP_RATIO, BOT_MAX_SPENDS, BOT_GOLD_RESERVE, BOT_EASY_TAX. Тест-страж: таких экспортов в balance.ts и таких имён в исходниках packages/sim/src нет. Заменяемые тесты — список в T1j. weights.json и weights-easy.json — ключ на каждый признак вариантов реестра по умолчанию, все значения 0.
  4) Минутный замер по $task: полный тик 30 ботов ≤ 15 мс, экономика ≤ 0,508 мс/бот/ход (база 05/T15d). Варианты и оценка считаются при любых весах, поэтому замер на нулевых весах валиден. Golden commander не меняются.

  Возврат ревью:
  - пункт 4 — `tools/bench` замер: экономика 30 ботов составляет 2,056 мс/бот/ход при лимите 0,508 мс/бот/ход; критерий не выполнен.
  - Причина по коду (решение владельца 2026-10-09). До T1j3 варианты не строились: при пустых весах planBotActions выходила сразу (brain.ts:96-98). С weights.json строится весь реестр T1j1, а в нём проходы, пропорциональные размеру карты, на каждый вариант:
    · options/city.ts:59 — копия всего `state.hexes.improvement` (размер карты) на каждый свой гекс;
    · options/build.ts:39-48 — на каждый граничный гекс и каждый тип постройки перебор всего `context.unitsByHex` (размер карты) с distance;
    · options/build.ts:62 и options/recruit.ts:49 — playerOptionMetrics на каждый вариант; внутри playerUpkeepPerSecond перебирает все `state.units`.
  - Что сделать, в объёме T1j3; для этого разрешено править bots/options/city.ts, bots/options/build.ts, bots/options/recruit.ts, state/pop-cap.ts:
    · city.ts: Δлимита благоустройства — без копии массива; в hexPopCap добавить необязательный параметр уровня благоустройства (по умолчанию текущий уровень гекса), формула остаётся одна;
    · build.ts: снабжение — перебор только своих отрядов `context.unitsByPlayer[playerId]` с distance ≤ supplyRadius, а не всей карты;
    · build.ts, recruit.ts: playerOptionMetrics — один раз на вызов функции вариантов, как в city.ts.
  - Запреты: удалить ранний выход brain.ts:96-98 и не вводить другие обходы — пропуск или урезание реестра при нулевых весах, выборку части гексов или вариантов, лимиты, кэш между тиками. Эффекты и признаки не меняются: табличные тесты T1j1 и T1j2 проходят без правок. Таймаут bot-determinism.test.ts:50 не трогать.
  - Подтверждение — тот же замер `pnpm --filter @hexfront/bench full-match --players=30,100 --minutes=1`: 30 ботов, полный тик ≤ 15 мс и экономика ≤ 0,508 мс/бот/ход; полный `pnpm verify` зелёный. Если после этих трёх правок бюджет не выполнен — остановиться и записать замер в STATUS, новых оптимизаций не придумывать.

- [ ] **T1j4. Параметры commander из весов** (bots/commander.ts, bots/run.ts, bots/weights.json, bots/weights-easy.json, balance.ts; подсистема бот). Запреты T1 и T1j действуют. Приёмка:
  1) Путь ботов в commander берёт порог слияния малых отрядов и радиус слияния из весов своего игрока: ключи commander.mergeBelowSoldiers и commander.mergeRadius в weights.json и weights-easy.json, начальные значения 25 и 3 (прежние BOT_MERGE_BELOW и BOT_MERGE_RADIUS, дальше их подбирает обучение); значения < 0 считаются 0. commanderCommands принимает веса по id игрока.
  2) BOT_MERGE_BELOW и BOT_MERGE_RADIUS удалены из balance.ts и packages/sim/src; тест-страж.
  3) Для игроков без бота и для армий людей команды commander не меняются: golden-хэши и тест «для игрока без ботов сохраняет прежнюю выдачу команд» (packages/sim/test/scenarios/commander.test.ts:307) без изменений.
  4) Минутный замер по $task: commander ≤ 0,348 мс/бот/ход, полный тик 30 ботов ≤ 15 мс.

- [ ] **T1j5. Обучение в tools/evolve по критериям T1** (tools/evolve, tools/replay; подсистема инструменты, без новых зависимостей). Запреты T1 и T1j действуют. Приёмка:
  1) Подсчёт критериев T1 — одна чистая функция в tools/replay:
     - по каждому игроку: самое долгое время подряд с золотом > 5 000 и самое долгое время подряд его отряда < 10 солдат, в секундах;
     - по матчу: победа, причина, тик.
     tools/replay/src/bot-match.ts считает acceptance (maxGoldOver5000S, maxUnitUnder10S — максимум по игрокам) через неё, tools/evolve — тоже. Тест: на 600 тиках сида 42 значения функции равны значениям, посчитанным в тесте прямым перебором по тикам.
  2) Матч и особь:
     - особь — все ключи weights.json, включая commander.*; веса целые в [−1000, 1000]; мутация ±sigma, параметр --sigma, по умолчанию 100;
     - 6 мест: оцениваемая особь и 5 соперников из текущего поколения и зала славы (лучшая особь каждого прошлого поколения), выбор по seeded rng, место особи на карте меняется по сидам; веса передаются botCommands и commanderCommands по id игрока;
     - по умолчанию до победы или 15 000 тиков (25:00);
     - лучшая особь переходит в следующее поколение без мутации.
  3) Фитнес особи — целое число, сумма по её матчам: 1000 × (6 − её место по playerPlaces) + 3000, если она победила захватом или выбыванием до 25:00, − 1000 × (её время золота > 5 000, с) / 120 − 1000 × (её время отряда < 10, с) / 30; деление — intDiv. Табличный тест на синтетических метриках.
  4) Запуск и отчёт:
     - после каждого поколения пишет weights.json (лучшая особь) и weights-easy.json (лучшая особь поколения --easy-generation, по умолчанию треть последнего поколения вниз, не меньше 1);
     - `pnpm evolve --resume` без пути продолжает с последнего состояния (номер поколения, вся популяция, зал славы, сиды, sigma);
     - --workers по умолчанию — os.availableParallelism() − 1;
     - vitest с --ticks=300 --population=4 --seeds=2 --generations=2 (это тест, не ботоматч): одинаковые weights.json и weights-easy.json при --workers=1 и --workers=4;
     - отчёт поколения в docs/reports/evolve/: лучший и средний фитнес, три метрики лучшей особи, время поколения.
     Полный `pnpm evolve` в задаче не запускать.

- [ ] **T1j6. Проверка T1j по коду**, сквозная проверка, не задача владельца. Запреты T1 и T1j действуют. Приёмка:
  1) В отчёте docs/reports/stage-06-t1j.md по каждому пункту T1j1–T1j5 указаны file:line кода и имя теста.
  2) Пусты все три поиска, вывод — в отчёте:
     - `rg -n "'(recruit|build|upgradeCity|improve|foundCity|rebuildSupply|setTax|startOffensive|stopOffensive|infantry|armor|artillery|fort|depot)'" packages/sim/src/bots/brain.ts packages/sim/src/bots/actions.ts packages/sim/src/bots/features.ts`;
     - `rg -n "balance" packages/sim/src/bots/brain.ts packages/sim/src/bots/actions.ts packages/sim/src/bots/features.ts`;
     - `rg -n "BOT_TAX_PEACE|BOT_TAX_WAR|BOT_ATTACK_|BOT_MAX_SPENDS|BOT_GOLD_RESERVE|BOT_EASY_TAX|BOT_MERGE_" packages/sim/src`.
  3) Полный `pnpm verify` зелёный.
  4) Только после этого T1j6 и T1j отмечаются [x].

- [ ] **T1i. Обучение весов**, задача владельца. Владелец запускает `pnpm evolve --population=12 --seeds=6 --generations=30`, продолжает через `pnpm evolve --resume` без пути, затем пишет `$next`.

- [ ] **T1e. Проверка родителя T1**, сквозная проверка, не задача владельца.
  *Приёмка:* `weights.json` и отчёт evolve закоммичены коммитом `balance:`; тест детерминизма T1e1 и один замер `pnpm --filter @hexfront/bench full-match --players=30 --minutes=5` на обученных весах подтверждают полный тик ≤ 15 мс; таблица трассировки T1 полная; T1e и T1 отмечаются `[x]` только после пройденного `$accept 06/T1`. Если `$accept` не прошёл, владелец повторяет `pnpm evolve --resume --generations=<больше>`.

| Требование T1 | Подзадача |
| --- | --- |
| Каталог действий и признаки | T1f |
| Мозг на обучаемых весах (`bots/brain.ts`, `bots/weights.json`) | T1ga–T1gd |
| Оценка `Σ вес × признак`, выбор и порядок | T1ga |
| Траты до резерва и одно действие на цель | T1gb |
| ▶/■ и ограничения easy | T1gc |
| Запреты T1 и сохранение easy/автопополнения | T1ga–T1ge |
| Удаление старого мозга и бюджеты | T1gd |
| Проверка всех критериев T1g | T1ge |
| Варианты команд с эффектами, мозг без знания команд | T1j1, T1j2 |
| Веса по игроку, уровни, удаление констант мозга | T1j3 |
| Параметры commander из весов | T1j4 |
| Офлайн-подбор весов | T1j5 |
| Проверка T1j по коду | T1j6 |
| Запуск обучения владельцем | T1i |
| Таблица трассировки и итоговая проверка | T1e |

- [ ] **T2. Итерации баланса** (перенос 05/T5). Сначала исправить измеритель `tools/balance` (сейчас `durationTicks` всегда равен `--ticks`, а доля нейтральных считается от всех гексов карты, включая воду, `tools/balance/src/worker.ts:66-99`): матч останавливается при победе (`state.winner`), `durationTicks` — тик победы или конец таймера 25:00; доля нейтральных — от гексов, которые можно занять. Прогон раунда — `--players=30 --ticks=15000`, не меньше 10 матчей. Метрики `tools/balance` на `gen`, 30 игроков: средняя длительность матча 18–22 мин, доля нейтральных гексов на 3:00 не больше 20 % (`gdd/00-overview.md`, «Темп матча»). Каждое изменение чисел — коммит `balance:` с метриками до/после; изменение числа больше ±30 % от исходного — вопрос владельцу в `QUESTIONS.md`. Не больше 3 раундов, затем решение владельца.
  *Приёмка:* отчёт `tools/balance` последнего раунда в `docs/reports/stage-06.md`; обе метрики в пределах цели или решение владельца после 3 раундов.

## Порядок

T1j1 → T1j2 → T1j3 → T1j4 → T1j5 → T1j6 → T1i → T1e → T2.

## Вне объёма

100 ботов, новые уровни ботов, производительность клиента (этап 07), плейтест (этап 08), CR-007, мультиплеер.

## Готово, когда

T1 и T2 отмечены `[x]`, `$accept 06/T1` пройден, отчёт в `docs/reports/stage-06.md`.
