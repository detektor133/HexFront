# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T16 |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-16 |

Очередь: 07/T19 → 07/T1 → 07/T2 → 07/T3 → 07/T4 → 07/T6 → 07/T20 → 07/T21 → 07/T7 → 07/T8 → 07/T9 → 07/T10 → 07/T11 → 07/T13 → 07/T15 → 07/T16 → 07/T12 → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

- 07/T16: повторно проверить границу job в приёмочном тесте CI: команды `build` и `check-bundle-size` должны находиться в одной job `deploy` файла `.github/workflows/pages.yml`.
- Приёмочный тест `apps/client/test/bundle-size.test.ts`: 4 теста прошли.
- `pnpm verify --changed` зелёный: build, types, lint, prettier, tests.
- Следующая задача: 07/T12.
- Читать: `docs/stages/stage-07-playable-build.md`, `apps/client/scripts/check-bundle-size.ts`, `apps/client/test/bundle-size.test.ts`, `.github/workflows/pages.yml`.
