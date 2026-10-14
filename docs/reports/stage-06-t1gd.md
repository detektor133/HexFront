# Отчёт 06/T1gd

## Сделано

- Удалены `packages/sim/src/bots/goals.ts` и `packages/sim/test/bots-goals.test.ts`.
- Удалён экспорт legacy-целей из `packages/sim/src/index.ts`.
- Удалены неиспользуемые ручные коэффициенты и пороги старой цепочки из `balance.ts`.
- Сохранены проверки easy, автопополнения, золотого резерва и ограничения трат.

## Проверки

- Профильные тесты мозга, признаков, детерминизма и golden: 23/23.
- `pnpm --filter @hexfront/sim typecheck`: OK.
- Минутный замер `pnpm --filter @hexfront/bench full-match --players=30,100 --minutes=1`:
  - 30 ботов: полный тик 5,527 мс, экономика 0,347 мс/бот/ход.
  - 100 ботов: экономика 0,159 мс/бот/ход; полный тик 44,56 мс, вне бюджета 100 ботов, который не входит в T1gd.
- `pnpm verify`: `verify: OK (281 с)`.

Golden commander не изменялись: diff не содержит файлов `packages/sim/test/golden`.
