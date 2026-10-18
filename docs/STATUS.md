# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T17v |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-18 |

Очередь: 07/T17v → 07/T17w → 07/T17t → 07/T17u → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

- 07/T17v принята ревью; внешняя высота 274 px подтверждена тестом с padding и рамкой.
- Измерение высоты идёт по внутреннему узлу с добавлением padding и рамки; наблюдение внешней карточки не создаёт петлю `ResizeObserver`.
- Связанный тест: `pnpm exec vitest run --project client-dom apps/client/test/t17m-hex-card.dom.test.tsx` — 8 тестов зелёные.
- `pnpm verify --changed` зелёный.
- Следующая задача: `$task 07/T17w`.
- Читать: блок T17v в `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/card-measurement.ts`, `apps/client/src/dev/HexCard.tsx`, `apps/client/src/match/MatchSurface.tsx`.
