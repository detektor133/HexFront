# Отчёт 06/T1ge — проверка T1g

## Трассировка

| Требование T1g | Подтверждение |
| --- | --- |
| `Σ вес × признак`, смена выбора и tie-break | `bot-actions-features.test.ts`, 5/5 в отчёте T1ga |
| Траты до `BOT_GOLD_RESERVE`, одна цель | `bot-brain.test.ts`, `bot-brain-regressions.test.ts`, 15/15 в отчёте T1gb |
| ▶/■ только для своих армий, easy без ▶ и с `BOT_EASY_TAX` | `bot-brain.test.ts`, `bot-determinism.test.ts`, 18/18 в отчёте T1gc |
| Legacy brain и ручные коэффициенты удалены | `goals.ts`, его тест и stale-ссылки отсутствуют; `rg` не нашёл удалённые символы |
| Golden commander не изменились | `git diff HEAD~1 -- packages/sim/test/golden packages/sim/src/bots/commander.ts packages/sim/src/bots/run.ts` пуст |
| Полный тик 30 ботов ≤ 15 мс | `full-match --players=30,100 --minutes=1`: 5,536 мс |
| Экономика ≤ 0,508 мс/бот/ход | тот же замер: 0,347 мс/бот/ход |

## Повторные проверки

- Профильные тесты мозга, признаков, детерминизма и golden: 23/23.
- `pnpm --filter @hexfront/sim typecheck`: OK.
- `pnpm verify --changed`: `verify: OK (11 с)`.
- `pnpm verify`: `verify: OK (276 с)`.

T1g и T1ge можно отметить `[x]`. Замер 100 ботов оставлен справочно: 44,703 мс полного тика не относится к бюджету T1g.
