# Ядро симуляции

## Fixed-point

- `FP = 1000`. Тип `Fp = number & { __fp: true }` (branded), конструкторы `fp(1.5)` только для констант баланса на этапе загрузки модуля.
- Операции: `fpMul(a, b) = intDiv(a * b, FP)`, `fpDiv(a, b) = intDiv(a * FP, b)`, `intDiv` — деление с усечением к нулю через `Math.trunc` (единственное разрешённое место).
- Все произведения держим в пределах `Number.MAX_SAFE_INTEGER` (2⁵³): население ≤ 10⁷ FP, солдаты ≤ 10⁷ FP — `fpMul` безопасен. Тест-инвариант проверяет это на экстремальных значениях.
- Проценты — FP-доли (0,2 = 200).
- Константы `balance.ts`: величины с единицами (золото, люди, солдаты, секунды, доли, множители, организованность) — fixed-point; счётчики (тики, гексы, радиусы, уровни, количества) — целые без масштаба.

## Случайность

- PRNG — xoshiro128** (`rng.ts`), сид матча — 32-битное целое.
- Независимые потоки — `fork(seed, streamId)`; номера потоков — именованные константы `RNG_STREAM` в `rng.ts`: `spawns` = 1 (распределение игроков по спавнам). Новый потребитель случайности получает новый номер, существующие не меняются — иначе ломаются реплеи.

## Состояние (эскиз, окончательные типы — в коде)

```ts
interface MatchState {
  tick: number;
  seed: number;
  fog: boolean;                   // туман войны; входит в стабильный хэш
  map: MapStatic;                 // неизменяемое: terrain, rivers, features
  hexes: HexState;                // SoA: owner: Int16Array, pop: Int32Array (FP), improvement: Uint8Array,
                                  //      building: Uint8Array, road: Uint8Array, buildProgress: Int32Array
  cities: City[];                 // отсортированы по id
  players: Player[];              // gold (FP), taxTarget, taxEffective, capitalCityId, status, autoCommand, ...
  units: Unit[];                  // отряды, отсортированы по id
  armies: Army[];                 // армии — группы отрядов (CR-001), отсортированы по id; auto — автокомандование (CR-006)
  battles: Battle[];              // активные бои (по целевому гексу)
  networks: SupplyNetwork[];      // кэш, пересчитывается раз в секунду
  fronts: Front[];                // кэш
  plans: ArmyPlan[];              // планы армий: фронт (грани своей границы, линия наступления), линия обороны (CR-002);
                                  // грани фронта переносит setHexOwner при каждой смене владельца гекса рядом
  constructions: Construction[];  // стройки: город, улучшение, постройка, дорога
  nextId: number;
  events: GameEvent[];            // события этого тика (для UI и логов), очищаются каждый тик
}
```

## Порядок систем в `step`

Порядок — часть контракта, менять только через ADR.

1. `applyCommands` — валидация и применение команд игроков и ботов (порядок: по `playerId`, затем по порядку поступления).
2. `taxSystem` — сдвиг `taxEffective` к `taxTarget`.
3. `constructionSystem` — прогресс строек, завершение.
4. `recruitSystem` — очереди набора, появление отрядов (резерв или автопополнение).
5. `networkSystem` — (раз в 10 тиков) сети снабжения, изоляция.
6. `supplySystem` — (раз в 10 тиков) `supplyLevel` отрядов; каждый тик — таймеры истощения.
7. `frontSystem` — (раз в 10 тиков) фронты; (раз в 50) `frontAllocator` выдаёт приказы движения.
8. `offensiveSystem` — (раз в 20 тиков) шаги наступления к линиям наступления.
9. `movementSystem` — прогресс переходов, захват пустых гексов, начало боёв при входе во врага.
10. `artillerySystem` — обстрел.
11. `combatSystem` — потери, org, исходы, отступления, капитуляции, захваты.
12. `attritionSystem` — потери от истощения.
13. `orgRegenSystem`.
14. `populationSystem` — рост, убыль, эффекты захвата.
15. `economySystem` — доход, содержание, банкротство.
16. `capitalSystem` — перенос столицы, выбывание.
17. `visionSystem` — (раз в 10 тиков) зоны обзора.
18. `victorySystem`.

## Команды

```ts
type Command =
  | { t: 'setTax'; rate: Fp }
  | { t: 'move'; unitIds: number[]; to: HexId }
  | { t: 'attack'; unitIds: number[]; target: HexId }
  | { t: 'setArmyAuto'; armyId: number; on: boolean } | { t: 'setAutoCommand'; on: boolean }   // CR-006
  | { t: 'createArmy'; name: string } | { t: 'renameArmy'; armyId: number; name: string }
  | { t: 'disbandArmy'; armyId: number }
  | { t: 'assignUnits'; unitIds: number[]; armyId: number | null }
  | { t: 'setAutoReinforce'; on: boolean }
  | { t: 'assignFront'; armyId: number; edges: EdgeId[] }   // грани своей границы (CR-004)
  | { t: 'setDefenseLine'; armyId: number; points: HexId[] } | { t: 'clearPlan'; armyId: number }
  | { t: 'setOffensiveLine'; armyId: number; edges: EdgeId[] }   // нарисовать (active: false)
  | { t: 'startOffensive'; armyId: number } | { t: 'stopOffensive'; armyId: number }   // «Начать» / «Стоп» (линия остаётся)
  | { t: 'clearOffensive'; armyId: number }
  | { t: 'split'; unitId: number; soldiers: Fp; to?: HexId } | { t: 'merge'; unitIds: number[] }
  | { t: 'bombard'; unitId: number; targetUnitId: number | null }
  | { t: 'recruit'; cityId: number; type: UnitType; soldiers: Fp }
  | { t: 'foundCity'; hex: HexId } | { t: 'upgradeCity'; cityId: number }
  | { t: 'improve'; hex: HexId } | { t: 'build'; hex: HexId; kind: 'fort' | 'depot' }
  | { t: 'rebuildSupply'; cityId: number };
```

- Каждая команда проходит `validate(state, playerId, cmd) → Ok | Rejected(reason)`. Отклонённые команды не меняют состояние; причина уходит клиенту.
- Команды — единственный способ изменить состояние (и для людей, и для ботов).
- Конверт команды `{ playerId, cmd, source? }`: `source: 'auto'` — команду отдал commander; такие команды не выключают auto у армии (`gdd/07-controls.md`, «Автокомандование»). Отказ такой команды приходит событием `commandRejected` с `auto: true` — интерфейс игроку его не показывает.

## Commander (CR-006)

- `packages/sim/src/bots/commander.ts`: `decide(map: MapStatic, view: PlayerView, armyId) → Command[]` — чистая функция снимка игрока (карта — статичная и общая, в снимок не входит), без случайности и мутаций, стабильный порядок. Линию наступления для ▶ строит `bots/commander-line.ts`; запуск по тикам — `bots/run.ts` `commanderCommands(state)`.
- Экономический мозг бота — `bots/economy.ts` `economyDecide(map, view)`, запуск — `bots/run.ts` `botCommands(state, botIds)`: раз в `BOT_THINK_TICKS` на бота, тик бота — `id mod BOT_THINK_TICKS`; команды — как у игрока (без `source`).
- Вне `step`: движок (локальный — в воркере, сервер — в комнате) раз в `COMMANDER_TICKS` для каждого игрока (все его армии с auto — в один тик, игроки распределены по тикам: `tick mod COMMANDER_TICKS = id игрока mod COMMANDER_TICKS`; снимок игрока строится один раз) вызывает `decide` и кладёт команды в очередь следующего тика с `source: 'auto'`.

## Запросы (чистые, без мутаций)

- `playerView(state, playerId)` — видимое состояние для клиента и ботов; при `fog: false` возвращает полный снимок без памяти тумана.
- `forecastBattle(map, view, unitIds, target)` — карта нужна для рельефа и рек: статическая карта не входит в снимок.
- `findPath(state, from, to, unitType, ownerId)`, `rebuildSupplyPath(state, cityId)`.
- `canFoundCity`, `recruitCapacity` и т. п. — для UI (кнопки с причинами).

## Детерминизм

- `hashState(state): string` — стабильный хэш (FNV-1a по сериализации в фиксированном порядке полей), включая `fog`.
- Реплей = карта + сид + лог команд с тиками. `replay(log).hash` должен совпадать на Node и в браузере.

## Производительность (цели)

- Матч 30 игроков, 4000 гексов, 200 отрядов: `step` ≤ 3 мс в среднем, ≤ 10 мс p99 на одном ядре (Node 22).
- Тяжёлые пересчёты (сети, обзор, фронты) — раз в секунду и **размазаны**: игрок `i` пересчитывается в тике `tick % 10 == i % 10`.
- Полный тик локального матча (`step` + commander и экономика ботов 30 игроков + снимок наблюдателя), gen-карта 80×60 seed 43, 30 игроков, до 7:00 матча: ≤ 15 мс в среднем на одном ядре (Node 22).

### Локальный режим

- Песочница, gen seed 43, 30 ботов, 5×, 10 минут матча: кадр p95 ≤ 33 мс, `usedJSHeapSize` ≤ 600 МБ, прирост кучи за последние 5 минут ≤ 10 %.
