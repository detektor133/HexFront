# Отчёт 06/T1ga — весовая оценка мозга

## Сделано

- Добавлены `BotWeights`, `scoreAction` и `rankActions` в `packages/sim/src/bots/brain.ts`.
- Коэффициенты вынесены в `packages/sim/src/bots/weights.json`; оценка использует сумму `вес × признак` без float-арифметики в симуляции.
- Положительные оценки сортируются по убыванию, затем по порядку каталога и id цели.

## Проверки

- `pnpm vitest run packages/sim/test/bot-actions-features.test.ts` — 5/5.
- `pnpm --filter @hexfront/sim typecheck` — OK.
- `pnpm ai-check --changed` — OK (91 с).
- `pnpm verify` — `verify: OK (286 с)`; 739 тестов, visual зелёный.

Следующая задача: `06/T1gb`.
