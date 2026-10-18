# Отчёт ревью 07/T17t

## Ревью 2026-10-18

- Новый текст задачи и родительские ограничения сверены.
- `apps/client/test/t17t-hud-tax.dom.test.tsx` заново сверён с критериями; добавленные после возврата проверки фиксируют `fill="none"` и `stroke="currentColor"` у остальных пяти SVG-иконок.
- Реальный путь `MatchPage → MatchSurface → Hud`, налоговая кнопка, доступность, popup-якорь, настройки, пауза и четыре ПК-размера подтверждены тестами.
- `pnpm exec vitest run --config vitest.config.ts apps/client/test/t17t-hud-tax.dom.test.tsx` — 3/3.
- `pnpm verify --changed` — зелёный: build, types, lint, prettier, tests.

Этап: 07/T17t
