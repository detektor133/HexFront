# Ревью 07/T17x — 2026-10-19

Результат: **ВОЗВРАТ**. Проверен коммит `2dc3458` с трейлером `Этап: 07/T17x`. Код и тесты не изменялись.

## Блокеры

1. `apps/client/test/t17g-movement-paths.test.ts:191-212` проверяет `UnitLayer.unitsAt` напрямую, но не реальный путь `MatchSurfaceRuntime.onTap`; поломка передачи hit-test в `selectUnits` останется незамеченной.
2. `apps/client/test/gesture.test.ts:37-47`, `apps/client/test/sandbox-selection.test.ts:94-107` не проверяют `MatchSurfaceRuntime.setSelection` на `/match`; поломка callback рамки или передача пустого списка останется незамеченной.

## Проверки

- `pnpm verify --changed` — зелёный.
- Запреты по изменённым файлам проверены через `rg`; совпадения `performance.now()` относятся к существующей клиентской временной шкале, запрещённых изменений sim, браузерных проверок, `any`, `@ts-ignore`, `TODO` и случайности нет.
- Замер производительности не запускался: критерий скорости в T17x отсутствует.
