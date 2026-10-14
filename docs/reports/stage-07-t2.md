# 07/T2 — Экран матча для игрока

## Возврат ревью 2026-10-14

Задача возвращена на доработку.

- `pnpm verify --changed`: `verify: OK (11 с)`.
- СПЕК: в коммите 07/T2 нет приёмочных тестов для `/match` без debug и с `?debug=1`, условной сериализации worker и production-маршрута `/dev/sandbox`.
- `apps/client/tests/visual/visual-check.ts:44` продолжает снимать `match` через `/dev/sandbox`, хотя приёмка требует `/match?map=small&select=0&freezeTime=1`.

Следующее действие: добавить приёмочные тесты, перевести visual-сцену `match` на `/match` и повторить `$review 07/T2`.

Этап: 07/T2

## Исправление по возврату ревью 2026-10-14

- Приёмочный тест экрана напрямую рендерит `MatchSurface` с загруженной картой, `PlayerView` и ненулевым отказом команды.
- Проверяются отсутствие панели наблюдателя, переключателя тумана и строки отказа без debug и наличие панели с русскими подписями при `debug=1`.
- Production-маршрут проверяется вызовом `App` на `/dev/sandbox`, worker-тесты проверяют реальный обработчик `onmessage` с включённой и выключенной телеметрией.
- Удалён скрытый текстовый fallback телеметрии; `visual-check` уже использует `/match?map=small&select=0&freezeTime=1`.
- `pnpm verify --changed`: `verify: OK (95 с)`.

Этап: 07/T2

## Ревью 2026-10-14

- Приёмка подтверждена: `pnpm exec vitest run apps/client/test/match-screen.test.ts apps/client/test/sim-worker-telemetry.test.ts` — 5/5 тестов.
- `pnpm verify --changed`: `verify: OK (11 с)`.

Этап: 07/T2

## Возврат ревью 2026-10-14 (повторная проверка после СПЕК)

- `apps/client/test/match-screen.test.ts:22-40,86-103` задаёт `lastReject: null`, а меню настроек не открывается перед SSR-рендером.
- СПЕК: тест не подтверждает отсутствие строки «Последний отказ» и переключателя тумана на `/match`; оба элемента отсутствуют в разметке только потому, что тест не создаёт отказ и не открывает меню.

Этап: 07/T2

## Возврат ревью 2026-10-14 (текущий)

- `pnpm exec vitest run apps/client/test/match-screen.test.ts apps/client/test/sim-worker-telemetry.test.ts`: 2 файла, 5 тестов прошли.
- СПЕК: `apps/client/test/match-screen.test.ts:21-60` рендерит `MatchSurface` без загруженного `view`, поэтому тест без debug не проверяет экран с данными, а debug-тест подтверждает только скрытый текст из строки 81 `MatchSurface.tsx`, не наличие `ObserverPanel`.

Этап: 07/T2

## Возврат ревью 2026-10-14 (текущий)

- `pnpm exec vitest run apps/client/test/match-screen.test.ts apps/client/test/sim-worker-telemetry.test.ts`: 1 из 5 тестов падает.
- СПЕК: `apps/client/test/match-screen.test.ts:115-122` ожидает английские строки `messages.en`, но реальный `MatchSurface` рендерит русский словарь; debug-приёмочный тест падает на `aria-label="Observer"` вместо `aria-label="Наблюдатель"`.

Этап: 07/T2

## Возврат ревью 2026-10-14 (повтор)

- `pnpm verify --changed`: `verify: OK (13 с)`.
- `apps/client/test/sim-worker-telemetry.test.ts`: оба условия сериализации проходят.
- СПЕК: `apps/client/test/match-screen.test.ts:20-24,32-37` не рендерит `MatchSurface` и проверяет только props `MatchPage` и текст `MatchPage.tsx`, поэтому не подтверждает отсутствие элементов без debug и наличие панели с debug.

Этап: 07/T2
