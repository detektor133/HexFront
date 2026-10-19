# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T17zb |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-19 |

Очередь: 07/T17y → 07/T17za → 07/T17zb → 07/T17aa → 07/T17ab → 07/T17ac → 07/T17ad → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

- 07/T17aa возвращена на доработку: строки `expectedLeft/expectedRight` не связаны с DOM, а `getComputedStyle(...).width` для auto-размеров даёт `null`, поэтому выход слота за HUD не ловится.
- Контрольная регрессия `transform: translateX(1000px)` или `position: relative; left: 1000px` на `.slot` оставляет тест зелёным.
- `pnpm verify --changed` зелёный, но приёмочный тест не закрывает границы элементов.
- Следующая задача: `$task 07/T17aa`.
- Читать: блок T17ab в `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/ArmyBar.tsx`, `packages/sim/src/queries/unit-view.ts`, `apps/client/test`.
