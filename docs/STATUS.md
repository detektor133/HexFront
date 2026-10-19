# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T17u |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-18 |

Очередь: 07/T17u → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

- 07/T17u усилена по возврату review: desktop-тест реального пути `MatchPage → MatchSurface → layout → Leaderboard` проверяет ширину и влияние полной высоты `contentRect` на `style.top` при popup.
- RED: временная передача `height: 1` падает assertion `expected '8px' to be '236px'`; GREEN: восстановленная передача `rect.height` даёт 5/5 той же командой.
- `pnpm verify --changed` — зелёный.
- Следующая задача после повторного review: 07/T17, задача владельца.
- Читать: `docs/stages/stage-07-playable-build.md`, `apps/client/test/t17i-leaderboard-layout.test.ts`.
