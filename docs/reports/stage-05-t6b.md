# Отчёт 05/T6b

## Сделано

- Конфигурация локального матча вынесена из dev-страницы в `apps/client/src/local/match-setup.ts`.
- Для обычного URL быстрого матча создаются 30 участников: игрок `0` остаётся человеком, игроки `1..29` передаются в список ботов.
- Параметры процедурной карты (`map=gen`, сид и число игроков) вынесены в общий `map-request.ts`; dev-страница использует тот же источник данных.
- Проверен стартовый пакет Web Worker: в него передаются карта, сид `42`, `players: 30`, 29 ботов и скорость `1`.

## Проверки

- `pnpm exec vitest run test/match-setup.test.ts test/local-match.test.ts test/sandbox-map.test.ts` — 6/6.
- `pnpm ai-check --changed` — `OK (13 с)`.
- `pnpm verify` — `verify: OK (294 с)`; build 1 с, types 9 с, lint 6 с, prettier 4 с, tests 180 с, visual 94 с.
