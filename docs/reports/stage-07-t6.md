# 07/T6 — пауза и выход

## Возврат ревью 2026-10-15

- `pnpm verify --changed` — OK: build, types, lint, prettier, tests и visual.
- `apps/client/test/pause.test.ts:166-181` не проверяет `resume`, снятие паузы и сохранение сида при «Заново»; три обработчика вызываются подряд, а проверяются только `reload()` и `assign('/')`.
- `apps/client/test/pause.test.ts:186-211` вызывает «Продолжить» и «Заново» без проверки результата.
- `apps/client/src/match/MatchSurface.tsx:46` использует для «Заново» только `window.location.reload()`, поэтому сохранение сида не подтверждено на реальном пути.
- `apps/client/src/dev/Hud.tsx:105-115` содержит самописный SVG с атрибутом `data-icon`, а не Tabler-иконку `player-pause`.

Этап: 07/T6
