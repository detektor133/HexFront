# 07/T2 — Экран матча для игрока

## Возврат ревью 2026-10-14

Задача возвращена на доработку.

- `pnpm verify --changed`: `verify: OK (11 с)`.
- СПЕК: в коммите 07/T2 нет приёмочных тестов для `/match` без debug и с `?debug=1`, условной сериализации worker и production-маршрута `/dev/sandbox`.
- `apps/client/tests/visual/visual-check.ts:44` продолжает снимать `match` через `/dev/sandbox`, хотя приёмка требует `/match?map=small&select=0&freezeTime=1`.

Следующее действие: добавить приёмочные тесты, перевести visual-сцену `match` на `/match` и повторить `$review 07/T2`.

Этап: 07/T2

## Возврат ревью 2026-10-14 (текущий)

- `pnpm exec vitest run apps/client/test/match-screen.test.ts apps/client/test/sim-worker-telemetry.test.ts`: 2 файла, 5 тестов прошли.
- СПЕК: `apps/client/test/match-screen.test.ts:21-60` рендерит `MatchSurface` без загруженного `view`, поэтому тест без debug не проверяет экран с данными, а debug-тест подтверждает только скрытый текст из строки 81 `MatchSurface.tsx`, не наличие `ObserverPanel`.

Этап: 07/T2

## Возврат ревью 2026-10-14 (повтор)

- `pnpm verify --changed`: `verify: OK (13 с)`.
- `apps/client/test/sim-worker-telemetry.test.ts`: оба условия сериализации проходят.
- СПЕК: `apps/client/test/match-screen.test.ts:20-24,32-37` не рендерит `MatchSurface` и проверяет только props `MatchPage` и текст `MatchPage.tsx`, поэтому не подтверждает отсутствие элементов без debug и наличие панели с debug.

Этап: 07/T2
