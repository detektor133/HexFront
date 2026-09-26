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
  map: MapStatic;                 // неизменяемое: terrain, rivers, features
  hexes: HexState;                // SoA: owner: Int16Array, pop: Int32Array (FP), improvement: Uint8Array,
                                  //      building: Uint8Array, road: Uint8Array, buildProgress: Int32Array
  cities: City[];                 // отсортированы по id
  players: Player[];              // gold (FP), taxTarget, taxEffective, capitalCityId, status, ...
  units: Unit[];                  // отряды, отсортированы по id
  armies: Army[];                 // армии — группы отрядов (CR-001), отсортированы по id
  battles: Battle[];              // активные бои (по целевому гексу)
  networks: SupplyNetwork[];      // кэш, пересчитывается раз в секунду
  fronts: Front[];                // кэш
  plans: ArmyPlan[];              // планы армий: фронт (сосед, участок, линия наступления), линия обороны (CR-002)
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
8. `offensiveSystem` — (раз в 20 тиков) шаги наступления по стрелкам.
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
  | { t: 'setOrder'; unitIds: number[]; order: 'idle' | 'hold' | 'expand' }
  | { t: 'armyOrder'; armyId: number; order: 'idle' | 'hold' | 'expand' }
  | { t: 'createArmy'; name: string } | { t: 'renameArmy'; armyId: number; name: string }
  | { t: 'disbandArmy'; armyId: number }
  | { t: 'assignUnits'; unitIds: number[]; armyId: number | null }
  | { t: 'setAutoReinforce'; on: boolean }
  | { t: 'assignFront'; armyId: number; edges: EdgeId[] }   // грани своей границы (CR-004)
  | { t: 'setDefenseLine'; armyId: number; points: HexId[] } | { t: 'clearPlan'; armyId: number }
  | { t: 'setOffensiveLine'; armyId: number; edges: EdgeId[] }   // нарисовать (active: false)
  | { t: 'startOffensive'; armyId: number } | { t: 'stopOffensive'; armyId: number }   // начать / пауза
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

## Запросы (чистые, без мутаций)

- `playerView(state, playerId)` — видимое состояние для клиента и ботов (туман).
- `forecastBattle(map, view, unitIds, target)` — карта нужна для рельефа и рек: статическая карта не входит в снимок.
- `findPath(state, from, to, unitType, ownerId)`, `rebuildSupplyPath(state, cityId)`.
- `canFoundCity`, `recruitCapacity` и т. п. — для UI (кнопки с причинами).

## Детерминизм

- `hashState(state): string` — стабильный хэш (FNV-1a по сериализации в фиксированном порядке полей).
- Реплей = карта + сид + лог команд с тиками. `replay(log).hash` должен совпадать на Node и в браузере.

## Производительность (цели)

- Матч 30 игроков, 4000 гексов, 200 отрядов: `step` ≤ 3 мс в среднем, ≤ 10 мс p99 на одном ядре (Node 22).
- Тяжёлые пересчёты (сети, обзор, фронты) — раз в секунду и **размазаны**: игрок `i` пересчитывается в тике `tick % 10 == i % 10`.
