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

07/T2 исправлена после ревью: `/match` использует отдельный `MatchSurface`, debug-панель включается только с `?debug=1`, production-маршрутизатор закрывает `/dev/*`, worker сериализует пакет только при включённой телеметрии.

Подтверждение: `apps/client/test/match-screen.test.ts` — 3 теста, `apps/client/test/sim-worker-telemetry.test.ts` — 2 теста, `pnpm verify --changed` — зелёный.

Следующая сессия: запустить `$review 07/T2` в новой сессии.
Читать: `docs/stages/stage-07-playable-build.md`, `apps/client/src/match/MatchSurface.tsx`, `apps/client/src/match/MatchSurfaceRuntime.tsx`, `apps/client/src/local/sim-worker.ts`.
