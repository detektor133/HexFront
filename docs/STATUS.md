# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T17w |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-18 |

Очередь: 07/T17v → 07/T17w → 07/T17t → 07/T17u → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

- 07/T17w выполнена и ждёт отдельного `$review`; `.strip` ArmyBar растянут на доступную ширину, пустая часть пропускает события карты через отдельную `.stripContent`.
- Карточки ArmyBar сохраняют внешнюю ширину 238 px с `box-sizing: border-box`, резерв и все кнопки остаются на реальном DOM-пути.
- Проверены `apps/client/test/army-bar-layout.test.ts` и `apps/client/test/t17l-army-bar.dom.test.tsx`; `pnpm verify --changed` зелёный.
- Следующая задача: 07/T17t.
- Читать: блок T17t в `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/Hud.tsx`, `apps/client/src/dev/Hud.module.css`, `docs/art/ui.md`.
