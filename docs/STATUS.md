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

- 07/T17u возвращена reviewer: `t17i` монтирует реальный путь, но подменяет `getBoundingClientRect` и `ResizeObserver` фиксированной геометрией, запрещённой новым текстом задачи.
- `pnpm exec vitest run apps/client/test/t17i-leaderboard-layout.test.ts` — 5/5; тест остаётся недостаточным по критерию реальной геометрии.
- Следующая сессия: исправить `apps/client/test/t17i-leaderboard-layout.test.ts`, затем `$review 07/T17u`.
- Читать: `docs/stages/stage-07-playable-build.md`, `apps/client/test/t17i-leaderboard-layout.test.ts`.
