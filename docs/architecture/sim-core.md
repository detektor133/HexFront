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
  armies: Army[];                 // отсортированы по id
  battles: Battle[];              // активные бои (по целевому гексу)
  networks: SupplyNetwork[];      // кэш, пересчитывается раз в секунду
  fronts: Front[];                // кэш
  arrows: OffensiveArrow[];
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
4. `recruitSystem` — очереди набора, появление армий.
5. `networkSystem` — (раз в 10 тиков) сети снабжения, изоляция.
6. `supplySystem` — (раз в 10 тиков) `supplyLevel` армий; каждый тик — таймеры истощения.
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
  | { t: 'move'; armyIds: number[]; to: HexId }
  | { t: 'attack'; armyIds: number[]; target: HexId }
  | { t: 'setOrder'; armyIds: number[]; order: 'idle' | 'hold' | 'expand' }
  | { t: 'assignFront'; armyIds: number[]; enemyId: number }
  | { t: 'arrow'; points: HexId[] } | { t: 'arrowStop'; arrowId: number }
  | { t: 'split'; armyId: number; soldiers: number } | { t: 'merge'; armyIds: number[] }
  | { t: 'bombard'; armyId: number; targetArmyId: number | null }
  | { t: 'recruit'; cityId: number; type: UnitType; soldiers: number }
  | { t: 'foundCity'; hex: HexId } | { t: 'upgradeCity'; cityId: number }
  | { t: 'improve'; hex: HexId } | { t: 'build'; hex: HexId; kind: 'fort' | 'depot' }
  | { t: 'rebuildSupply'; cityId: number };
```

- Каждая команда проходит `validate(state, playerId, cmd) → Ok | Rejected(reason)`. Отклонённые команды не меняют состояние; причина уходит клиенту.
- Команды — единственный способ изменить состояние (и для людей, и для ботов).

## Запросы (чистые, без мутаций)

- `playerView(state, playerId)` — видимое состояние для клиента и ботов (туман).
- `forecastBattle(view, attackerIds, target)`.
- `findPath(state, from, to, unitType, ownerId)`, `rebuildSupplyPath(state, cityId)`.
- `canFoundCity`, `recruitCapacity` и т. п. — для UI (кнопки с причинами).

## Детерминизм

- `hashState(state): string` — стабильный хэш (FNV-1a по сериализации в фиксированном порядке полей).
- Реплей = карта + сид + лог команд с тиками. `replay(log).hash` должен совпадать на Node и в браузере.

## Производительность (цели)

- Матч 30 игроков, 4000 гексов, 200 армий: `step` ≤ 3 мс в среднем, ≤ 10 мс p99 на одном ядре (Node 22).
- Тяжёлые пересчёты (сети, обзор, фронты) — раз в секунду и **размазаны**: игрок `i` пересчитывается в тике `tick % 10 == i % 10`.
