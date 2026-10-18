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

- 07/T17u исправлена по возврату reviewer: `t17i` больше не подменяет `getBoundingClientRect` и фиксированную геометрию `174×142`.
- Реальный путь `MatchPage → MatchSurface → layout → Leaderboard` сохранён; jsdom проверяет DOM и inline-инварианты без выдачи пикселей за браузерную геометрию.
- `pnpm exec vitest run apps/client/test/t17i-leaderboard-layout.test.ts` — 5/5.
- `pnpm verify --changed` — зелёный.
- Следующая сессия: `$review 07/T17u`.
- Читать: `docs/stages/stage-07-playable-build.md`, `apps/client/test/t17i-leaderboard-layout.test.ts`.
