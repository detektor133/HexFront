# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T17y |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-19 |

Очередь: 07/T17y → 07/T17za → 07/T17zb → 07/T17aa → 07/T17ab → 07/T17ac → 07/T17ad → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

- 07/T17za возвращена на доработку: нужен тест отказа для склада в основной сети; текущий тест проверяет только изолированный склад.
- `pnpm verify --changed` зелёный: build, types, lint, prettier и tests.
- Следующая задача: `$task 07/T17zb`.
- Читать: блок T17zb в `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/HexCard.tsx`, `apps/client/src/dev/hex-actions.ts`, `packages/sim/src/commands/rebuild-supply.ts`.
