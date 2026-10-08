# Отчёт 05/T14e — индекс отрядов и поиск пути

## Сделано

- Добавлен производный индекс «гекс → отряды» и индекс города по гексу вне хэша `MatchState`.
- Индекс обновляется при создании, наборе, перемещении, отступлении, split, merge, основании города, уничтожении и гибели отряда.
- `ownUnitsAt`, `isHostileHex`, `inEnemyZoc` и проверки отступления используют индекс вместо прохода по глобальному массиву отрядов.
- `search` переиспользует `g`, `prev`, поколения и кучу для каждого состояния; массивы размера карты не создаются при каждом поиске.

## Проверки

- `pnpm exec vitest run packages/sim/test/unit-path-index.test.ts packages/sim/test/scenarios/movement.test.ts packages/sim/test/scenarios/offensive-direction.test.ts` — 35 тестов прошли.
- `unit-path-index.test.ts` проверяет split, merge, уничтожение и эквивалентность индекса полному построению после 3000 тиков war-сценария.
- `pnpm verify --changed` — `verify: OK (177 с)`.
- `pnpm verify` — `verify: OK (267 с)`; build, типы, lint, prettier, 656 тестов и visual прошли; golden-хэши не изменились.

## Ожидает `$accept`

Ботоматч не запускался по правилам `$task`. Владелец запускает ровно:

`pnpm --filter @hexfront/bench full-match --players=30,100 --minutes=5`

Результат `step` нужно сравнить с базой `5a78c89`. До этого задача остаётся `[ ]`.
