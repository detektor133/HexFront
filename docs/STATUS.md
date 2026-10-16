# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T12a |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-16 |

Очередь: 07/T19 → 07/T1 → 07/T2 → 07/T3 → 07/T4 → 07/T6 → 07/T20 → 07/T21 → 07/T7 → 07/T8 → 07/T9 → 07/T10 → 07/T11 → 07/T13 → 07/T15 → 07/T16 → 07/T12a → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

- 07/T12a: исправлен красный CI — уничтожение восьми кэшированных состояний маркера передаёт `context: true`.
- 07/T12a: приёмочный тест проверяет реальные Pixi-объекты маркера и рендера прогноза: без наведения остаётся только `Graphics`-иконка без `BitmapText`.
- Проверено: `pnpm exec vitest run apps/client/test/battle-marker.test.ts apps/client/test/graphics-context.test.ts` — 8/8; `pnpm verify --changed` — зелёный.
- Следующая задача: 07/T17, раунды замечаний владельца.
- Читать: `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/unit-layer.ts`, `apps/client/src/match/battle-marker.ts`, `apps/client/src/dev/plan-layer.ts`, `apps/client/test/battle-marker.test.ts`.
