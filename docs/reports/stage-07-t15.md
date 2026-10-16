# 07/T15 — Дельты снимков и память

## Повторное ревью после `4789f19`

`pnpm verify --changed` — зелёный.

`pnpm vitest run --config vitest.all.config.ts --project client apps/client/test/view-delta-memory.test.ts` — 1 из 3 тестов прошёл; критерий 2 падает на `TypeError: context.scale is not a function` в `apps/client/test/view-delta-memory.test.ts:20-30,97-104`.

### Возврат

- СПЕК: canvas-stub должен реализовать методы, которые вызывает реальный `BitmapText`-путь, включая `context.scale`; иначе тест не проверяет `BitmapText` и завершается до ассерта.

Проверит владелец (раунды замечаний этапа): вывод `pnpm probe:memory` — запуск Playwright запрещён правилами проекта.

Этап: 07/T15
