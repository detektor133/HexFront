# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T17w |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-18 |

Очередь: 07/T17t → 07/T17u → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

- 07/T17t возвращена на доработку после review: тест не проверяет цвет SVG золота, неизменность остальных иконок и кнопку автокомандования в открытом меню настроек.
- Изменены `apps/client/src/dev/Hud.tsx`, `apps/client/src/dev/Hud.module.css`, `apps/client/test/t17k-hud.dom.test.tsx`, `apps/client/test/t17t-hud-tax.dom.test.tsx`.
- Приёмка покрыта DOM-тестом через `MatchPage → MatchSurface → Hud` для 1366×768, 1440×900, 1920×1080 и 2560×1440; проверены SVG, клики, фокус, зона 44×44 и ResizeObserver.
- `pnpm verify --changed` зелёный: 99 тестов.
- Следующая задача: 07/T17u.
- Читать: `docs/stages/stage-07-playable-build.md`, `apps/client/src/dev/Hud.tsx`, `apps/client/src/dev/Hud.module.css`, `apps/client/test/t17t-hud-tax.dom.test.tsx`.
