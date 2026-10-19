# 07/T17aa — повторное ревью

## Возврат ревью 2026-10-19 после `8ca61ce6`

- `СПЕК: apps/client/test/t17aa-hud-layout.dom.test.tsx:49-170` — тест подменяет `getBoundingClientRect` для всех проверяемых элементов заранее рассчитанными прямоугольниками. Контрольная регрессия с шириной `.slotText` 1000 px остаётся зелёной, поэтому фактическое переполнение длинных значений не проверяется.
- `pnpm verify --changed` — `verify: OK` (build, types, tests).

Этап: 07/T17aa

## Возврат ревью 2026-10-19 после `b3ca789`

- Тест раскладки не вызывает `getBoundingClientRect()` и рассчитывает идеальную сетку из ширины viewport и padding; мутация `.slotText { flex-basis: 1000px; }` оставит тест зелёным.
- Тест проверяет `taxWrap`, но не фактические границы `.taxButton` и его содержимого; мутация `.taxButton { width: 1000px; flex: 0 0 1000px; }` останется зелёной.
- Тест не проверяет дочерние элементы HUD вне `.slot` и `.taxWrap`; смещение `.settingsWrap` на 1000 px останется зелёным.
- `pnpm verify --changed` — `verify: OK` (build, types, tests).

Этап: 07/T17aa
