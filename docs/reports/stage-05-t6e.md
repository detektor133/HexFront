# Отчёт 05/T6e

## Трассировка T6

| Критерий | Подтверждение |
| --- | --- |
| Меню «Играть» запускает полный матч | `apps/client/test/main-menu.test.ts`: 3/3; `quickMatchUrl()` возвращает `/match?map=gen&seed=42&players=30` |
| Локальный матч на 30 участников | `apps/client/test/match-setup.test.ts`: 2/2; `count = 30` |
| Один человек и 29 ботов | `apps/client/test/match-setup.test.ts`, `apps/client/test/local-match.test.ts`: игрок `0` не входит в `bots`, список содержит `1..29` |
| Сгенерированная карта | `apps/client/test/match-setup.test.ts`, `apps/client/test/local-match.test.ts`: `map = gen`, сид передаётся в Worker |
| Обычный экран матча | `apps/client/test/main-menu.test.ts`: `/match` выделен отдельным маршрутом; `MatchPage.tsx` подключён в `main.tsx` |
| Экран конца матча | `apps/client/test/match-end.test.ts`: победа, поражение и отсутствие результата — 3 проверки |
| Таймлапс карты | `apps/client/test/match-end.test.ts`: 20 кадров сжимаются до 16, пустая история остаётся пустой |
| Экран вынесен из `dev` | обычный `/match` отделён от `/dev/*`; dev-маршрут `/dev/sandbox` остаётся доступен |

## Проверки

- Профильные тесты T6a–T6d: 4 файла, 12/12.
- `pnpm verify --changed` — `verify: OK (9 с)`.
- `pnpm verify` — `verify: OK (269 с)`; visual прошёл.

## Ожидает владельца

Скриншоты обычного меню, экрана матча и экрана конца матча не подготовлены: процесс `$task` запрещает браузер, Playwright и ручной запуск клиента. T6e и родительская T6 остаются `[ ]` до команды владельца на визуальный прогон.
