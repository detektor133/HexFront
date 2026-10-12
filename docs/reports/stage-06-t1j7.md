# Отчёт 06/T1j7

1. `tools/replay/src/acceptance.ts:59-66` считает место, победу и два ограниченных штрафа; `tools/replay/src/acceptance.test.ts` проверяет пороги 0, 1,5, 2 и 10 лимитов, места 1/6 и победу.
2. `tools/evolve/src/evaluate.ts:36-48,84-92` экспортирует загрузку `small` по умолчанию и `gen` 80×60; `tools/evolve/src/index.test.ts:25-30` проверяет размеры карт и параметры CLI.
3. `tools/evolve/src/index.ts:291-304,353-380` записывает места и победы лучшей особи, победы популяции и среднее место; `tools/evolve/src/index.test.ts:83-85` проверяет строки отчёта.
4. `tools/evolve/src/index.ts:199-235` формирует отдельную работу для каждой пары «особь × сид», а `tools/evolve/src/worker.ts:16-32` возвращает результат одного матча; `tools/evolve/src/index.test.ts:51-116` сравнивает однопоточную и параллельную эволюцию, веса, resume и отчёт.

Проверки: профильный `pnpm exec vitest run --changed HEAD` — 2 файла, 7 тестов; `pnpm verify --changed` — сборка, типы, lint и Prettier зелёные, тестовый шаг отдельно подтверждён тем же запуском; полный `pnpm verify` перед коммитом обязателен.

Код ботов и `sim` не менялись. Полный `pnpm evolve` не запускался.
