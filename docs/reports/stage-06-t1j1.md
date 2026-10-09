# Отчёт 06/T1j1

## Сделано

- Исправлены замечания ревью в `packages/sim/src/bots/options/helpers.ts`: эффекты `cost`, `upkeep`, `income`, `strength`, `defense`, `supply` нормализуются относительно текущих показателей игрока; неполный `state` или `context` отбрасывается до обращения к производным данным.
- `upgradeCity` считает прирост через `cityGold` соседних уровней, а `improve` — через разницу лимитов `hexPopCap` до и после улучшения.
- Тесты `packages/sim/test/bot-options.test.ts` проверяют фиктивные definitions, нормализацию цены, обе формулы, частичный контекст и ненулевые эффекты всех девяти видов команд на игровом сценарии.
- `buildOptions` предлагает строительство только на граничных гексах и гексах собственных городов; внутренние негородские гексы покрыты отдельным тестом.

## Подтверждение

- Реестр девяти видов команд: `packages/sim/test/bot-options.test.ts:56-67` — 1/1.
- Расширяемость definitions: `packages/sim/test/bot-options.test.ts:70-81` — 1/1.
- Ненулевые эффекты всех видов, формулы, нормализация и защита состояния: `packages/sim/test/bot-options.test.ts:110-220` — 5/5.
- `pnpm --filter @hexfront/sim typecheck` — OK.
- `pnpm ai-check --changed` — OK (13 с).
- `pnpm verify --changed` — `verify: OK (102 с)`; лог `.ai-logs/verify-2026-10-09T05-23-29.log`.
- Полный `pnpm verify` — `verify: OK (290 с)`; лог `.ai-logs/verify-2026-10-09T05-25-14.log`.

Следующая задача: `$review 06/T1j1` в новой сессии.

## Ревью

ВОЗВРАТ И ИСПРАВЛЕНИЕ:

- `buildOptions` перебирает все `context.ownedHexes`, а критерий разрешает только `context.borderHexes` и гексы собственных городов; внутренние негородские гексы попадают в каталог вариантов (`packages/sim/src/bots/options/build.ts:25-27`).

Проверки ревью:

- `pnpm exec vitest run packages/sim/test/bot-options.test.ts` — 8/8.
- `pnpm --filter @hexfront/sim typecheck` — OK.
- `pnpm exec depcruise packages/sim/src packages/sim/test --config .dependency-cruiser.cjs` — 160 модулей, 861 зависимость, нарушений нет.
- `pnpm ai-check --changed` — OK (10 с).
- Исправлено в `packages/sim/src/bots/options/build.ts`: внутренние негородские гексы исключены из каталога.
- Регрессионный тест `не предлагает строить на внутреннем негородском гексе` — 1/1.

## Итоговое ревью

- **OK.** Все 4 пункта приёмки подтверждены: реестр — `bot-options.test.ts:56-67`, допустимость вариантов — генераторы в `bots/options/*.ts` и `bot-options.test.ts:84-108`, эффекты — `bot-options.test.ts:110-220`, расширяемость — `bot-options.test.ts:70-81`.
- `pnpm exec vitest run packages/sim/test/bot-options.test.ts` — 9/9.
- `pnpm --filter @hexfront/sim typecheck` — OK.
- `pnpm exec depcruise packages/sim/src packages/sim/test --config .dependency-cruiser.cjs` — 160 модулей, 861 зависимость, нарушений нет.
- Стражи ограничений по изменённым файлам не нашли `playerView`, случайность, float-арифметику, запрещённые импорты или обходы карты; внутренние негородские гексы покрыты регрессионным тестом.
