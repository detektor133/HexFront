# 07/T1 — Полоса при стройках

## Повторное ревью 2026-10-14

- Приёмочные тесты `apps/client/test/construction-arc.test.ts` проходят: 3/3.
- Тест вызывает реальный `createEconomyLayer`, перехватывает `GraphicsContext` после `stroke` и проверяет фактические точки каждого пути дуги в пределах `радиус дуги + width` для двух и трёх строек с одной дорогой.
- Тест-сторож проверяет все вызовы `.arc()` в `economy-layer.ts`, `plan-layer.ts` и `unit-chips.ts`.
- `pnpm verify --changed`: `verify: OK (13 с)`; build, types и tests зелёные.
- Golden-хэши и `packages/sim` в diff отсутствуют.

Решение: `OK`, задача отмечена `[x]`; следующая задача — 07/T2.
