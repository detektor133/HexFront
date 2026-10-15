# 07/T11 — Конец матча, выбывание, отсчёт победы

## Возврат ревью 2026-10-15

- `pnpm exec vitest run apps/client/test/match-end.dom.test.tsx packages/protocol/test/victory-hold-snapshot.test.ts packages/sim/test/victory-hold.test.ts` — 3 файла, 12 тестов прошли.
- `pnpm verify --changed` — `verify: OK (17 с)`: build, types и tests зелёные.
- СПЕК: `apps/client/test/match-end.dom.test.tsx:75-87` монтирует `MatchEndScreen`, а не `Hud` или `MatchSurface`, поэтому не проверяет строку отсчёта в HUD на реальном пути вызова и не подтверждает условие «у игрока, который не держит города».
- СПЕК: `packages/sim/test/victory-hold.test.ts:11-27,30-39` вручную устанавливает `holdPlayer` и `holdTicks`, поэтому не проверяет сценарий захвата ≥ 70 % городов через `step` и может пройти при невыполненной логике определения владельца.

Этап: 07/T11

