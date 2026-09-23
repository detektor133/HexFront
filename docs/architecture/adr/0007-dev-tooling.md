# ADR-0007: Инструменты разработки

**Статус:** принято · 2026-09-23

## Решение
Dev-зависимости корня монорепо (в `sim` runtime-зависимостей по-прежнему нет):

| Пакет | Зачем |
| --- | --- |
| `typescript` 5.x | Язык (ADR-0001) |
| `eslint`, `@eslint/js`, `typescript-eslint`, `globals` | Линтер и правила детерминизма `sim` (AGENTS.md §3) |
| `eslint-plugin-import-x` | Автоматический порядок импортов (CONVENTIONS.md §4) |
| `prettier` | Форматирование (CONVENTIONS.md §4) |
| `dependency-cruiser` | Границы пакетов (`overview.md`) |
| `vitest`, `@vitest/coverage-v8`, `fast-check` | Тесты и покрытие `sim` ≥ 90 % (`testing.md`) |
| `@types/node` 22 | Типы Node для сервера и инструментов |

Vitest настроен через `test.projects` в `vitest.config.ts` (преемник workspace-файла).

## Отклонено
- `eslint-plugin-import` — медленнее и хуже работает с flat config; `import-x` — его совместимый форк.
- `commitlint` — этап 01 требует проверку коммитов без сторонних зависимостей (`tools/commit-check`).
