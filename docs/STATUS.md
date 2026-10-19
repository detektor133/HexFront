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

- 07/T17aa исправлена: DOM-тест измеряет границы пяти `.slot`, `.taxButton` и всех потомков HUD, включая `.settingsWrap`, паузу и `victoryHold`.
- Контрольные мутации `flex-basis: 1000px`, `width/flex: 1000px` и `translateX(1000px)` дали RED; восстановленный тест дал GREEN.
- `pnpm verify --changed` зелёный; задача отмечена `- [~]` и ждёт повторного review.
- Следующая задача: `$task 07/T17ab`.
- Читать: блок T17ab в `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/ArmyBar.tsx`, `packages/sim/src/queries/unit-view.ts`, `apps/client/test`.
