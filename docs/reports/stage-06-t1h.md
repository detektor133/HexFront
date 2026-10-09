# Отчёт 06/T1h — `tools/evolve`

## Сделано

- Добавлен пакет `tools/evolve` и команда `pnpm evolve` без новых зависимостей.
- Реализована `(μ,λ)-ES`: целочисленные веса, `μ = floor(λ / 2)`, seeded RNG и стабильный tie-break по индексу кандидата.
- Оценка выполняется в `worker_threads`; результаты сортируются по индексу, поэтому параллельность не меняет итог.
- Поддержаны `--population`, `--seeds`, `--generations`, `--workers`, `--resume`, а также пути вывода.
- После поколения сохраняются `weights.json`, JSON-состояние resume и Markdown-отчёт в `docs/reports/evolve/`.
- `brainDecide` и `botCommands` принимают набор весов инструмента, не меняя поведение по умолчанию.

## Проверки

- Vitest T1h: 2/2; 300 тиков дают одинаковые веса при 1 и 4 worker_threads.
- Resume-тест продолжает поколение 1 до поколения 2 и создаёт новый отчёт.
- `pnpm --filter @hexfront/evolve typecheck`: OK.
- `pnpm verify --changed`: OK.
- `pnpm verify`: `verify: OK (285 с)`.
- Полный `pnpm evolve` не запускался: это прямо запрещено приёмкой T1h.
