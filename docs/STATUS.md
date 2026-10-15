# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T7 |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-15 |

Очередь: 07/T19 → 07/T1 → 07/T2 → 07/T3 → 07/T4 → 07/T6 → 07/T7 → 07/T8 → 07/T9 → 07/T10 → 07/T11 → 07/T13 → 07/T14 → 07/T15 → 07/T16 → 07/T12 → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

- 07/T7 исправлена: приёмочный тест проходит пять сцен через `MatchPage`/`MatchSurface` на трёх размерах и передаёт их в `validateMatchLayout`.
- В альбомном HUD подписи используют `var(--font-size-caption)`, а не 11 px.
- `pnpm verify --changed` зелёный: build, types, lint, prettier, tests, visual.
- Следующее действие — `$review 07/T7` в новой сессии.
- Читать: `docs/stages/stage-07-playable-build.md`, `apps/client/test/match-layout.test.ts`, `apps/client/src/dev/Hud.module.css`, `docs/reports/stage-07-t7.md`.
