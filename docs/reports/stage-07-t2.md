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
- `pnpm verify --changed`: `verify: OK (11 с)`.
- СПЕК: `apps/client/test/match-screen.test.ts:20-43` проверяет исходники и оболочку `MatchPage`, но не рендерит `MatchSurface` с реальным debug-путём.
- СПЕК: `apps/client/test/match-screen.test.ts:46-49` проверяет production-маршрут regex-ом, а не вызовом маршрутизатора.
- `apps/client/src/match/MatchSurface.tsx:1,10` переиспользует `SandboxSurface` из `DevSandboxPage.tsx`, что нарушает требование отдельного компонента экрана `/match`.

Этап: 07/T2

## Возврат ревью 2026-10-14 (повтор)

- `pnpm verify --changed`: `verify: OK (13 с)`.
- `apps/client/test/sim-worker-telemetry.test.ts`: оба условия сериализации проходят.
- СПЕК: `apps/client/test/match-screen.test.ts:20-24,32-37` не рендерит `MatchSurface` и проверяет только props `MatchPage` и текст `MatchPage.tsx`, поэтому не подтверждает отсутствие элементов без debug и наличие панели с debug.

Этап: 07/T2
