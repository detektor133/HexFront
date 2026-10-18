# Статус

| Поле | Значение |
| --- | --- |
| Текущий этап | 07 — Играбельная сборка и интерфейс |
| Текущая задача | 07/T17p |
| Ветка | `stage-07` |
| Последнее обновление | 2026-10-17 |

Очередь: 07/T19 → 07/T1 → 07/T2 → 07/T3 → 07/T4 → 07/T6 → 07/T20 → 07/T21 → 07/T7 → 07/T8 → 07/T9 → 07/T10 → 07/T11 → 07/T13 → 07/T15 → 07/T16 → 07/T12a → 07/T17a → 07/T17b → 07/T17c → 07/T17d → 07/T17e → 07/T17f → 07/T17g → 07/T17h → 07/T17i → 07/T17j → 07/T17k → 07/T17l → 07/T17m → 07/T17n → 07/T17o → 07/T17p → 07/T17q → 07/T17r → 07/T17s → 07/T17t → 07/T17u → 07/T17 → 07/T18

## Блокеры и открытые вопросы

Открытых вопросов нет.

## Следующая сессия

- 07/T17q: исправлен возврат ревью и ошибка CI typecheck в DOM-тесте ArmyBar.
- Тест проверяет реальный путь `MatchPage → MatchSurface`, четыре inline-координаты на 360×640, 1440×900 и 1920×1080, выбор/смену/Escape, `cardHeight` 88/160, лидерборд на 2/5 строк, налог и содержимое ArmyBar.
- Контролируемый `ResizeObserver` проверяет `Math.max(contentRect.height, scrollHeight)`, две разные высоты, повторную высоту без новой подписки и точные пары mount/unmount для dock.
- `pnpm verify --changed` — зелёный.
- Следующая задача — 07/T17r: HexCard непосредственно над ArmyBar; затем T17s → T17t → T17u.
- Читать блоки T17r–T17u в `docs/stages/stage-07-playable-build.md`, `apps/client/src/match/layout.ts`, `apps/client/src/match/MatchSurface.tsx` и `apps/client/src/dev/ArmyBar.tsx`.
