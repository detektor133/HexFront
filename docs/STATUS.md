# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T2 |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-14 |

Очередь: 07/T1 → 07/T2 → 07/T3 → 07/T4 → 07/T5 → 07/T6 → 07/T7 → 07/T8 → 07/T9 → 07/T10 → 07/T11 → 07/T13 → 07/T14 → 07/T15 → 07/T16 → 07/T12 → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

07/T2: экран `/match` отделён от маршрута песочницы через `MatchSurface`, debug-панель и worker-телеметрия включаются только с `?debug=1`, production скрывает `/dev/*`, visual-сцена `match` снимается с `/match`.

Следующая сессия: проверить задачу `$review 07/T2`; после ревью взять 07/T3.
Читать: `docs/stages/stage-07-playable-build.md`, `apps/client/src/match/MatchPage.tsx`, `apps/client/src/match/MatchSurface.tsx`, `apps/client/src/local/sim-worker.ts`, `apps/client/tests/visual/visual-check.ts`.
