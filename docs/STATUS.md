# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T6 |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-15 |

Очередь: 07/T19 → 07/T1 → 07/T2 → 07/T3 → 07/T4 → 07/T6 → 07/T7 → 07/T8 → 07/T9 → 07/T10 → 07/T11 → 07/T13 → 07/T14 → 07/T15 → 07/T16 → 07/T12 → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

Исправлен красный CI 07/T6: `pause.test.ts` проверяет кнопки через реальное дерево `MatchSurface`, включая `PauseMenu`, `visibilitychange` и `MatchEnd`; язык теста зафиксирован как `ru-RU`.
Профильный запуск `pnpm exec vitest run apps/client/test/pause.test.ts` — 5/5.
`pnpm verify --changed` зелёный: build, types, lint, prettier, tests и visual.
Следующая задача — 07/T7; перед ней прочитать блок T7 в `docs/stages/stage-07-playable-build.md` и `docs/art/ui.md`.
Читать: `docs/stages/stage-07-playable-build.md`, `docs/gdd/08-match.md`, `apps/client/src/match/pause-controller.ts`, `apps/client/test/pause.test.ts`.
