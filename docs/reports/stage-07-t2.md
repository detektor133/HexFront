# 07/T2 — Экран матча для игрока

## Возврат ревью 2026-10-14

Задача возвращена на доработку.

- `pnpm verify --changed`: `verify: OK (11 с)`.
- СПЕК: в коммите 07/T2 нет приёмочных тестов для `/match` без debug и с `?debug=1`, условной сериализации worker и production-маршрута `/dev/sandbox`.
- `apps/client/tests/visual/visual-check.ts:44` продолжает снимать `match` через `/dev/sandbox`, хотя приёмка требует `/match?map=small&select=0&freezeTime=1`.

Следующее действие: добавить приёмочные тесты, перевести visual-сцену `match` на `/match` и повторить `$review 07/T2`.

Этап: 07/T2
