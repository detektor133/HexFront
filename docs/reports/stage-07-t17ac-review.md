# 07/T17ac — ревью

Результат: **OK**. Проверен коммит `5ea7538` и весь diff с трейлером `Этап: 07/T17ac`. Код и тесты reviewer не изменялись.

## Критерии

- `packages/sim/src/queries/player-view.ts:293-305`: `playerView` оставляет свою стройку независимо от `visible` и удаляет чужую при `visible[hex] !== 1`.
- `packages/sim/test/player-view.test.ts:116-142`: сценарий с включённым по умолчанию `state.fog = true` проверяет видимую чужую стройку `100`, невидимую чужую `101` и свою невидимую `102`; ожидаются только `[100, 102]`.
- Существующие проверки `units`, `hexes.pop`, `hexes.visible`, `hexes.road` и `recruits` сохранены без изменений.
- Клиентский `apps/client/src/dev/economy-layer.ts` не менялся.

## Проверки

- `pnpm exec vitest run packages/sim/test/player-view.test.ts` — 1 файл, 14 тестов зелёные.
- `pnpm verify --changed` — зелёный; build, типы и тесты завершены без ошибок.
- `rg` по изменённым файлам не нашёл `economy-layer`, `drawConstructionEffects`, `eslint-disable`, `@ts-ignore`, `Math.random`, `Date`, `TODO` или `any` вне штатных идентификаторов `recruits`.
- В diff нет изменений баланса, зависимостей, `tools/agent-loop/**`, `.codex/**`, клиентского рендера, скриншотов, браузерных или визуальных проверок.

Этап: 07/T17ac
