# Отчёт 05/T6c

## Сделано

- Обычный маршрут `/match` подключён к экрану матча через `apps/client/src/match/MatchPage.tsx`.
- Экран сохраняет карту, HUD, карточки и обработчики приказов существующего локального матча.
- Маршруты `/dev/map`, `/dev/units`, `/dev/sandbox`, `/dev/economy` и `/dev/ui` не изменены.

## Проверки

- `pnpm exec vitest run test/main-menu.test.ts` — 3/3.
- `pnpm ai-check --changed` — OK за 13 с.
- `pnpm verify` — `verify: OK (297 с)`; build 1 с, types 8 с, lint 6 с, prettier 4 с, tests 184 с, visual 94 с.
