# Отчёт ревью 07/T9

Результат: возврат.

- `pnpm verify --changed` — зелёная.
- `apps/client/src/dev/Hud.tsx:234-242`: кнопка паузы остаётся обычным `<button>`, поэтому не поддерживает удержание с подписью и блокировкой действия.
- `apps/client/test/mobile-labels.dom.test.tsx:105-122`: тест реальных панелей сверяет только `title` и `aria-label`, поэтому не ловит отсутствие `IconButton` у паузы HUD.
