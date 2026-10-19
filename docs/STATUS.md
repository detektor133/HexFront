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

- 07/T17aa исправлена: тест монтирует реальный `Hud` с длинными population/rate/gold.
- Тест измеряет `getBoundingClientRect()` HUD, пяти `.slot`, `.taxButton` и всех дочерних элементов на 1280, 1366, 1440 и 1920.
- Контрольная мутация `.slot` с `min-width: 1000px` дала RED; восстановленный CSS дал GREEN.
- `pnpm verify --changed` зелёный.
- Следующая задача: `$task 07/T17ab`.
- Читать: блок T17ab в `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/ArmyBar.tsx`, `packages/sim/src/queries/unit-view.ts`, `apps/client/test`.
