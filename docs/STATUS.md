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

- 07/T17zb возвращена на доработку: DOM-тест подменяет `Selection` и не проверяет, что `createLocalEngine` передаёт план склада из `rebuildSupplyPlan`.
- Исполнитель должен добавить проверку реального engine-пути для изолированного и подключённого склада; UI-проверки кнопки, preview path, цены и команды сохранить.
- `pnpm verify --changed` зелёный: build, types, lint, prettier и tests.
- Следующая задача: `$task 07/T17aa`.
- Читать: блок T17aa в `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/Hud.tsx`, `apps/client/src/dev/Hud.module.css`, `apps/client/test`.
