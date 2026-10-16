# 07/T15 — Дельты снимков и память

## Повторное ревью после `4789f19`

`pnpm verify --changed` — зелёный.

`pnpm vitest run --config vitest.all.config.ts --project client apps/client/test/view-delta-memory.test.ts` — 1 из 3 тестов прошёл; критерий 2 падает на `TypeError: context.scale is not a function` в `apps/client/test/view-delta-memory.test.ts:20-30,97-104`.

### Возврат

- СПЕК: canvas-stub должен реализовать методы, которые вызывает реальный `BitmapText`-путь, включая `context.scale`; иначе тест не проверяет `BitmapText` и завершается до ассерта.

Проверит владелец (раунды замечаний этапа): вывод `pnpm probe:memory` — запуск Playwright запрещён правилами проекта.

Этап: 07/T15

## Возврат ревью после `e9c9ab8`

- `apps/client/scripts/memory-probe.ts:5-8` и `package.json:22` не запускают `vite preview`; `pnpm probe:memory` подключается к заранее поднятому `http://localhost:4173` и падает с `ERR_CONNECTION_REFUSED`, поэтому критерий 3 не выполнен на реальном пути запуска.

`pnpm exec vitest run --config vitest.all.config.ts --project client apps/client/test/view-delta-memory.test.ts` — 3/3.

Этап: 07/T15
