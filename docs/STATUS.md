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

- 07/T17zb принята: DOM-тест получает план склада через реальный `createLocalEngine().select()`.
- Проверены изолированный и подключённый склад, `path`, `cost`, preview, кнопка и команда `rebuildSupply`.
- Контрольная мутация `rebuildSupplyPlan(...)` → `null` дала RED на assertion; рабочий код восстановлен.
- `pnpm verify --changed` зелёный: build, types, lint, prettier и tests.
- Следующая задача: `$task 07/T17aa`.
- Читать: блок T17aa в `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/Hud.tsx`, `apps/client/src/dev/Hud.module.css`, `apps/client/test`.
