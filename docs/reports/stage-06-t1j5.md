# Отчёт 06/T1j5

1. `tools/replay/src/acceptance.ts:23` содержит чистый `calculateBotAcceptance`; `bot-match.ts:160` и `tools/evolve/src/evaluate.ts:70` используют его. Тест `tools/replay/src/acceptance.test.ts:6` сверяет 600 тиков с прямым профилем; 2/2.
2. `tools/evolve/src/index.ts:113` выбирает пять seeded-соперников из поколения и зала славы, меняет место особи; `evaluate.ts:54` передаёт веса в `commanderCommands` и `botCommands`. `--sigma`, диапазон `[-1000, 1000]`, 15 000 тиков и элитный перенос реализованы в `index.ts:77`, `index.ts:210`, `index.ts:248`.
3. `tools/replay/src/acceptance.ts:46` считает fitness через `intDiv`; табличный тест `acceptance.test.ts:22` подтверждает формулу.
4. `index.ts:183` сохраняет веса, resume с популяцией/залом славы/сидами/sigma и отчёт с тремя метриками; `index.test.ts:18` подтверждает одинаковый результат для 1 и 4 worker_threads, resume и отчёт.

Проверки: профильные тесты — 4/4; `pnpm verify --changed` — OK (39 с); полный `pnpm verify` — `verify: OK (289 с)`.

Задача ждёт `$review`; полный `pnpm evolve` не запускался по критериям задачи.
