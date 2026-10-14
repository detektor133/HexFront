# Отчёт 06/T1e3 — удаление старой цепочки экономики

## Сделано

- Удалён `packages/sim/src/bots/economy.ts` и публичный экспорт `economyDecide`.
- Удалена историческая ссылка на старую цепочку из актуальной архитектурной документации.
- Сценарные проверки налогов, дороги, easy и автопополнения перенесены на `brainDecide`; устаревший тест старого мозга удалён.

## Проверки

- `pnpm --filter @hexfront/sim exec vitest run test/bot-brain-regressions.test.ts` — 5/5.
- `pnpm verify --changed` — `verify: OK (117 с)`.

Следующая задача: `06/T1e4`.
