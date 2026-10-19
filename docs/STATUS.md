# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T17al |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-19 |

Очередь: 07/T17ak → 07/T17al → 07/T17 → 07/T18

## Блокеры и открытые вопросы

2026-10-19 · П.2 раунда 6: темп полной покраски карты и раннего начала боёв отложен до следующего плейтеста; отдельная задача в этом раунде не заводится.

## Следующая сессия

- Сделано: T17al ждёт ревью; добавлены переводы всех `GameEvent['t']`, типизированный `eventLabel` и отдельная раскладка `event-feed`.
- Проверено: лента не выходит за viewport, не пересекает leaderboard/bottom-panel; высоты 44/88/132 px; онбординг остаётся в `left-column`.
- Следующая задача: `$review 07/T17al` в новой сессии.
- Читать: блоки T17al–T17 в `docs/stages/stage-07-playable-build.md`, `docs/STATUS.md`, `docs/DECISIONS.md`.
- Файлы: `apps/client/src/dev/EventFeed.tsx`, `apps/client/src/match/layout.ts`, `apps/client/src/match/MatchSurface.tsx`, `apps/client/src/i18n/dict.ts`, `apps/client/test/t17al-*`.
