# 07/T17s — Компактный лидерборд

## Возврат ревью 2026-10-18

- ВОЗВРАТ: ширина ПК лидерборда жёстко задана как 238 px и не определяется компактным содержимым (`apps/client/src/match/layout.ts:5,117-121`).
- СПЕК: `apps/client/test/leaderboard.dom.test.tsx:80-110` проверяет раскрытие свёрнутого списка, но не сворачивание открытого лидерборда.
- СПЕК: `apps/client/test/leaderboard.dom.test.tsx:80-110` не проверяет неперекрытие места и счёта.
- СПЕК: `apps/client/test/t17i-leaderboard-layout.test.ts:84-121` не проверяет ширину на 1366×768 и 1920×1080 и независимость высоты от нижней панели на ПК.
- `pnpm verify --changed` — зелёный: build, types, tests; 18 с.

Этап: 07/T17s

## Возврат ревью 2026-10-18 по изменённому тексту

- ВОЗВРАТ: ширина раскладки использует первые пять `view.players`, а не пять видимых после сортировки строк; `apps/client/src/match/MatchSurface.tsx:98-101`, `apps/client/src/match/layout.ts:122-131`, `apps/client/src/dev/Leaderboard.tsx:39-44`.
- ВОЗВРАТ: расчёт высоты 244 px не учитывает две границы панели и оставляет вертикальное переполнение на пяти строках; `apps/client/src/match/layout.ts:140-147`, `apps/client/src/dev/Leaderboard.module.css:3-10,43-48`.
- ВОЗВРАТ: изменённый налоговый тест сравнивает финальную раскладку с самой собой и больше не проверяет перенос ниже окна; `apps/client/test/t17j-tax-leaderboard.dom.test.tsx:214-221`.
- `pnpm verify --changed` — зелёный: build, types, tests; 17 с.

Этап: 07/T17s
