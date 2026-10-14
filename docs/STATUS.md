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

07/T2: проверка вернула приёмочный тест `apps/client/test/match-screen.test.ts`, потому что он не рендерит `MatchSurface` и не подтверждает элементы экрана без debug и с debug.

Следующая сессия: переписать `apps/client/test/match-screen.test.ts` на проверку реального рендера `MatchSurface`, затем повторить `$review 07/T2`.
Читать: `docs/stages/stage-07-playable-build.md`, `apps/client/src/match/MatchPage.tsx`, `apps/client/src/match/MatchSurface.tsx`, `apps/client/src/local/sim-worker.ts`, `apps/client/tests/visual/visual-check.ts`.
