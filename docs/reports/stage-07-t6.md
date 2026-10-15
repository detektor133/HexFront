# 07/T6 — пауза и выход

## Ревью 2026-10-15

- `apps/client/test/pause.test.ts` заново сверены с критериями T6 после исправления СПЕК: все пять тестов проходят через `MatchSurface` и проверяют pause/resume, перезапуск с тем же seed, переходы на `/`, паузу при `visibilitychange`, отсутствие debug-скорости и геометрию `player-pause`.
- Профильный тест: 5/5.
- `pnpm verify --changed`: OK.

## Исправление СПЕК 2026-10-15

- Приёмочные тесты вызывают обработчики через дерево `MatchSurface`: `pause`/`resume`, меню, перезапуск с тем же seed и переход на `/` проверяются результатами вызовов.
- `visibilitychange` с `hidden` проверяет и остановку worker, и появление `PauseMenu`.
- `/match` без `debug` рендерится целиком: тест проверяет отсутствие `ObserverPanel` и выбора скорости, кнопку 44×44 и пути Tabler `player-pause`.
- `pnpm exec vitest run --config vitest.config.ts apps/client/test/pause.test.ts` — 5/5.
- `pnpm verify --changed` — OK: build, types, lint, prettier, tests, visual.

Этап: 07/T6

## Возврат ревью 2026-10-15 (повторная сверка после исправления СПЕК)

- `pnpm exec vitest run --config vitest.config.ts apps/client/test/pause.test.ts` — 5/5.
- `pnpm verify --changed` — зелёный.
- СПЕК: `apps/client/test/pause.test.ts:324-337` рендерит только `Hud`, поэтому не проверяет отсутствие `ObserverPanel` и выбора скорости на полном `/match` без `debug`.
- `apps/client/src/dev/Hud.tsx:105-117` и `apps/client/test/pause.test.ts:343-345` используют четыре самописные вертикальные линии и `data-icon="player-pause"`; имя атрибута не подтверждает требуемую Tabler-иконку.

Этап: 07/T6

## Возврат ревью 2026-10-15 (повторная сверка)

- `pnpm verify --changed` — OK: build, types, lint и tests.
- СПЕК: `apps/client/test/pause.test.ts:257-265` передаёт `withView=false`, поэтому `Hud` и `ObserverPanel` не рендерятся; отсутствие выбора скорости не проверяется на реальном `/match` без `debug`.
- `apps/client/src/dev/Hud.tsx:105-114` содержит самописный SVG из четырёх вертикальных линий с `data-icon="player-pause"`, а не Tabler-иконку `player-pause`.

Этап: 07/T6

## Возврат ревью 2026-10-15 (повторная сверка после СПЕК)

- `pnpm exec vitest run apps/client/test/pause.test.ts` — 5/5, но зелёный тест не закрывает оба замечания ниже.
- СПЕК: `apps/client/test/pause.test.ts:222-234` после `visibilitychange` проверяет только `setPaused(true)`; открытие меню паузы, требуемое текстом T6, не подтверждается.
- СПЕК: `apps/client/test/pause.test.ts:259-269` проверяет только наличие произвольного `data-icon="player-pause"`; геометрия Tabler-иконки и кнопка 44×44 этой проверкой не подтверждаются.
- `pnpm verify --changed` запущен; лог `.ai-logs/verify-2026-10-15T01-40-47.log` содержит успешные build и visual-проверки, итоговый код команды в консоль не выведен.

Этап: 07/T6

## Возврат ревью 2026-10-15

- `pnpm verify --changed` — OK: build, types, lint, prettier, tests и visual.
- `apps/client/test/pause.test.ts:166-181` не проверяет `resume`, снятие паузы и сохранение сида при «Заново»; три обработчика вызываются подряд, а проверяются только `reload()` и `assign('/')`.
- `apps/client/test/pause.test.ts:186-211` вызывает «Продолжить» и «Заново» без проверки результата.
- `apps/client/src/match/MatchSurface.tsx:46` использует для «Заново» только `window.location.reload()`, поэтому сохранение сида не подтверждено на реальном пути.
- `apps/client/src/dev/Hud.tsx:105-115` содержит самописный SVG с атрибутом `data-icon`, а не Tabler-иконку `player-pause`.

Этап: 07/T6
