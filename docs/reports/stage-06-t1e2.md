# Отчёт 06/T1e2 — бюджет полного тика

## Проверка критерия

- Команда: `pnpm --filter @hexfront/bench full-match --players=30 --minutes=5`.
- Параметры: Node `v24.15.0`, gen-карта, seed `43`, 30 ботов, 3000 тиков.
- Полный тик (`step + commander + economy + snapshot`) по минутам: `4,156 / 3,935 / 3,864 / 3,794 / 5,003 мс`.
- Лимит `15 мс` выполнен на всех минутах; `budgetExceeded: false`.

## Проверки

- `pnpm verify --changed`: `verify: OK (10 с)`.
- `pnpm verify`: `verify: OK (283 с)`.

Следующая задача: `06/T1e3`.
