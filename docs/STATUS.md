# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
- 07/T17an возвращена: map long-press и двойной тап идут через смонтированный `MatchSurface`/runtime, но центр map-меню не проверен.
- `slow`: coverage отделено от полного функционального прогона и считается только для `packages/sim`.
- Проверено: T17an 9/9; `pnpm verify --changed` — зелёный.
- Следующая задача: 07/T17.
- Читать: блок T17an в `docs/stages/stage-07-playable-build.md`, `MatchSurfaceRuntime.tsx`, `ArmyBar.tsx`, `map-view.ts`, тесты T17an/T17m.
Очередь: 07/T17af → 07/T17am → 07/T17an → 07/T17 → 07/T18

## Блокеры и открытые вопросы

2026-10-19 · П.2 раунда 6: темп полной покраски карты и раннего начала боёв отложен до следующего плейтеста; отдельная задача в этом раунде не заводится.
2026-10-20 · Повторное ревью 07/T17af принято: тест связывает четыре path-вызова диаграммы с последующим `stroke` и не допускает добавленную диагональ перед клинками; `pnpm verify --changed` зелёный.

## Следующая сессия

- Сделано: 07/T17an переведена в `[~]`; тест двойного тапа и ПКМ проходит через реальный canvas `MapView`/`attachInput` и runtime.
- Исправлено: проверены точный hex камеры, длительность `tokens.motion.map` и полный payload приказа с hex назначения.
- Проверки: RED→GREEN мутации callback doubleTap, длительности, order и hex; `pnpm verify --changed` — зелёный; T17an 9/9.
- Следующее действие: запустить `$review 07/T17an` в новой сессии.
- Читать: блок T17an в docs/stages/stage-07-playable-build.md, apps/client/test/t17an-radial-menu.test.ts, apps/client/src/render/map-view.ts.
