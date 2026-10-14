# Отчёт 06/T1e1 — детерминизм прогона ботов

## Сделано

- Добавлен `packages/sim/test/bot-determinism.test.ts`.
- Тест дважды создаёт матч на `small` с seed 42 и шестью ботами, выполняет 1200 тиков и сохраняет команды каждого тика.
- Сравниваются полный журнал команд и итоговый `hashState`.

## Проверка критериев

- `pnpm exec vitest run packages/sim/test/bot-determinism.test.ts`: 1/1 тест, OK за 3,41 с.
- `pnpm verify --changed`: `verify: OK (102 с)`.
- `pnpm verify`: `verify: OK (279 с)`.

Следующая задача: `06/T1e2`.
