# 07/T6 — пауза и выход

## Возврат ревью 2026-10-15

- `pnpm exec vitest run apps/client/test/pause.test.ts` — 6/6.
- `pnpm verify --changed` — OK.
- Возврат: `apps/client/test/pause.test.ts:37-117` проверяет только `createPauseController`, поэтому не подтверждает реальные кнопки HUD, `PauseMenu`, `visibilitychange` в `MatchSurface` и кнопку «В меню» на `MatchEnd`.
- Возврат: `apps/client/src/dev/Hud.tsx:105-109` использует самописный SVG вместо требуемой Tabler-иконки `player-pause`.

Этап: 07/T6
