# Отчёт 06/T1j1

## Сделано

- Добавлен реестр `COMMAND_OPTIONS` и типы вариантов в `packages/sim/src/bots/options/index.ts` и `types.ts`.
- Варианты recruit, build, city, rebuild-supply, tax и offensive разделены по файлам.
- Эффекты считают цены и изменения экономики, силы, обороны и снабжения через функции `sim`.
- `BUILDING_DEFS` получил `supplyRadius`; `incomePerSecond` экспортирован без изменения формулы.
- Фиктивные тип войск и постройка подхватываются через `definitions` без изменения реестра.

## Подтверждение

- Реестр девяти видов команд: `packages/sim/test/bot-options.test.ts:42` — 1/1.
- Расширяемость definitions: `packages/sim/test/bot-options.test.ts:55` — 1/1.
- Ненулевые fixed-point эффекты: `packages/sim/test/bot-options.test.ts:68` — 1/1.
- `pnpm --filter @hexfront/sim typecheck` — OK.
- `pnpm verify --changed` — `verify: OK`.
- Полный `pnpm verify` — `verify: OK (286 с)`.

Следующая задача: 06/T1j2.

## Ревью

ВОЗВРАТ: эффекты не нормализованы относительно показателей игрока, а тесты допускают команды без существующих проверок валидности.
