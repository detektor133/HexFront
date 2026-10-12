# Отчёт 06/T1j5

1. `tools/replay/src/acceptance.ts:23` содержит чистый `calculateBotAcceptance`; `bot-match.ts:160` и `tools/evolve/src/evaluate.ts:70` используют его. `acceptance.test.ts:13` прогоняет 600 тиков `small` на сиде 42 и сверяет результат с прямым перебором тиков.
2. `tools/evolve/src/index.ts:113` выбирает пять seeded-соперников из поколения и зала славы; `evaluate.ts:23` меняет место особи по сиду и передаёт веса в `commanderCommands` и `botCommands`. `--sigma`, диапазон `[-1000, 1000]`, 15 000 тиков и элитный перенос реализованы в `index.ts:77`, `index.ts:210`, `index.ts:248`.
3. `tools/replay/src/acceptance.ts:46` считает fitness через `intDiv`; табличный тест `acceptance.test.ts:71` подтверждает формулу. `evaluate.ts:96` начисляет бонус только за `cities` и `lastStanding`.
4. `index.ts:183` сохраняет веса, resume с популяцией/залом славы/сидами/sigma и отчёт с тремя метриками. `index.test.ts:22` подтверждает одинаковый результат для 1 и 4 worker_threads, смену места по сидам, resume и восстановление `seeds/sigma`.

Проверки до ревью: профильные тесты — 5/5; `pnpm verify --changed` — `verify: OK (41 с)`; полный `pnpm verify` — `verify: OK (300 с)`.

Ревью 2026-10-12: `pnpm exec vitest run tools/replay/src/acceptance.test.ts tools/evolve/src/index.test.ts` — 2 файла, 5 тестов; typecheck `@hexfront/evolve` и `@hexfront/replay` — зелёный. Замер `pnpm --filter @hexfront/bench full-match --players=30,100 --minutes=1`: 30 ботов — `step 1,83 мс`, commander `0,089 мс/бот/ход`; 100 ботов — `step 11,696 мс`, commander `0,331 мс/бот/ход`; оба сценария `budgetExceeded: false`. В изменённых файлах поиски `playerView`, `Math.random`/запрещённых float-функций, новых `BOT_*`, `for...in` и зависимостей дали пустой вывод; найденный `foundCity` находится только в телеметрии `bot-match.ts`, не в мозге бота. Полный `pnpm evolve` не запускался по критериям задачи.

Критерии T1j5 подтверждены; задача принята ревью.
