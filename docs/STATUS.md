# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T17ae |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-20 |

Очередь: 07/T17ae → 07/T17af → 07/T17am → 07/T17an → 07/T17 → 07/T18

## Блокеры и открытые вопросы

2026-10-19 · П.2 раунда 6: темп полной покраски карты и раннего начала боёв отложен до следующего плейтеста; отдельная задача в этом раунде не заводится.
2026-10-20 · Ревью 07/T17ae возвращено: приёмочный тест не проверяет геометрию вершин и параметры обводки знаков; `pnpm verify --changed` зелёный.

## Следующая сессия

- Сделано: T17ae усилила приёмочный тест реального `createEconomyLayer(...).setView(...)`: проверяются радиусы вершин fort/depot через `tokens.construction.size` и обводки всех трёх знаков через `construction.outline`/`construction.fill`.
- Проверено: целевой тест зелёный; контрольная мутация `buildingRadius = hexRadius * 0.1` дала RED на assertion радиуса; восстановленный код прошёл `pnpm verify --changed`.
- Следующая задача: 07/T17af.
- Читать: блоки T17af и T17am в `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/construction-glyphs.ts`, `apps/client/src/dev/economy-layer.ts`, `apps/client/test/construction-glyphs.test.ts`, `docs/art/tokens.json`, `docs/art/style-guide.md`.
