# Отчёт 06/T1j6

## Трассировка T1j1–T1j5

| Пункт | Код | Тест |
| --- | --- | --- |
| T1j1. Варианты и эффекты | `packages/sim/src/bots/options/index.ts:47-65`, `options/*.ts` | `packages/sim/test/bot-options.test.ts:56-240` |
| T1j2. Мозг без знания команд | `packages/sim/src/bots/brain.ts:103-138`, `features.ts:19-35` | `bot-brain.test.ts`, `bot-brain-dynamic.test.ts`, `bot-actions-features.test.ts`, `guards/bot-brain-source.test.ts` |
| T1j3. Веса по игроку и удаление констант | `packages/sim/src/bots/brain.ts:25-35`, `run.ts:99-125`, `weights*.json` | `bot-weights.test.ts`, `bot-determinism.test.ts`, `guards/bot-brain-source.test.ts` |
| T1j4. Параметры commander из весов | `packages/sim/src/bots/run.ts:77-88`, `commander.ts:157-181,316-333` | `packages/sim/test/scenarios/commander.test.ts:276-298`, `guards/bot-brain-source.test.ts` |
| T1j5. Обучение весов | `tools/replay/src/acceptance.ts:25-65`, `tools/evolve/src/evaluate.ts:70-102`, `tools/evolve/src/index.ts:73-101,115-124,142-158,237-350` | `tools/replay/src/acceptance.test.ts`, `tools/evolve/src/index.test.ts` |

## Сквозные проверки

Три обязательных поиска из критериев T1j6 дали пустой вывод:

```text
rg -n "'(recruit|build|upgradeCity|improve|foundCity|rebuildSupply|setTax|startOffensive|stopOffensive|infantry|armor|artillery|fort|depot)'" packages/sim/src/bots/brain.ts packages/sim/src/bots/actions.ts packages/sim/src/bots/features.ts
rg -n "balance" packages/sim/src/bots/brain.ts packages/sim/src/bots/actions.ts packages/sim/src/bots/features.ts
rg -n "BOT_TAX_PEACE|BOT_TAX_WAR|BOT_ATTACK_|BOT_MAX_SPENDS|BOT_GOLD_RESERVE|BOT_EASY_TAX|BOT_MERGE_" packages/sim/src
```

- `pnpm verify --changed` — `verify: OK (10 с)`.
- `pnpm verify` — `verify: OK (290 с)`; build, types, lint, prettier, tests и visual зелёные.
- `pnpm ci:wait` до начала задачи: CI зелёный для текущего `HEAD`.

## Возврат ревью 2026-10-12

- T1j4.4 не подтверждён: `pnpm --filter @hexfront/bench full-match --players=30,100 --minutes=1` дал для 30 ботов `commanderMsPerBotTurn = 0,470 мс/бот/ход` при пороге `0,348`; полный тик `1,677 мс` и экономика `0,386 мс/бот/ход` проходят.

Изменений кода нет. Возврат закрыт новым замером ниже.

## Приёмка ревью 2026-10-12

- Три обязательных поиска дали пустой вывод.
- `pnpm --filter @hexfront/bench full-match --players=30,100 --minutes=1`: для 30 ботов полный тик `1,715 мс` при лимите `15`, commander `0,080 мс/бот/ход` при лимите `0,348`, экономика `0,389 мс/бот/ход` при лимите `0,508`.
- Полный `pnpm verify` ранее завершён как `verify: OK (290 с)` на том же коде; после этого менялась только документация.
- Трассировка T1j1–T1j5 и тесты сохранены в отчёте выше. T1j6 и T1j отмечены `[x]`.
