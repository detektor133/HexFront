# Отчёт 07/T7 — возврат ревью

## Результат

- `ВОЗВРАТ`: приёмочный тест проверяет только синтетический `validateMatchLayout`, а не реальные сцены и путь `/match` через `MatchSurface`.
- Сторож `apps/client/test/match-layout.test.ts:134-143` не сканирует `apps/client/src/dev`, поэтому пропускает `top: 56px` и `top: 52px` в `apps/client/src/dev/ObserverPanel.module.css:3,44`.
- Отсутствуют перечисление сцен и пути к новым эталонам, требуемые приёмкой.

## Проверки

- `pnpm verify --changed` — зелёный: build, types, lint, prettier, tests, visual.
- Новые visual-эталоны заявлены в `apps/client/tests/visual/baseline/`, но отдельный отчёт T7 с перечнем сцен и путями не создан.

Этап: 07/T7
