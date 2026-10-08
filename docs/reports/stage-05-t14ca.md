# Отчёт 05/T14ca — целочисленная аналитическая математика

## Сделано

- Добавлен `expNegFixed` с масштабом `ANALYTIC_FP = 1 000 000`, адаптивным range reduction и целочисленным вычислением без `Math.exp`/`Math.pow`.
- Добавлены операции `growthRate`, `growthIntegral`, `decayDeficit` и `decayOvercap` для якорной модели населения.
- Экспорт математического модуля добавлен в `packages/sim/src/index.ts`.

## Приёмка

| Критерий | Подтверждение |
| --- | --- |
| Монотонность и насыщение экспоненты | `packages/sim/src/math/exponential.test.ts`, 100 property-прогонов; аргумент `20 × ANALYTIC_FP` даёт 0 |
| Переполнение и детерминизм | тест на дефиците `10 000 000 000`; два одинаковых вызова дают одинаковый результат |
| Расхождение с мелкошаговым эталоном ≤ 1 человека | тест на 25:00 с шагом 1 мс: разница не более 1 единицы аналитического fixed-point |
| Убыль сверх лимита | тест `decayOvercap` с `POP_OVERCAP_DECAY` |

## Проверки

- `node --version` → `v24.15.0`.
- `pnpm exec vitest run packages/sim/src/math/exponential.test.ts` → 5 тестов прошли.
- `pnpm verify --changed` → `verify: OK (134 с)`.
- `pnpm verify` → `verify: OK (307 с)`.

## Вне объёма

Материализация якорей, классовые агрегаты дохода, протокол и golden-хэши остаются в T14cb–T14cd.
