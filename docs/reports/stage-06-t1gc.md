# Отчёт 06/T1gc — ограничения армий и easy

## Сделано

- Команды `startOffensive` и `stopOffensive` создаются только для планов армий текущего игрока.
- Easy не проходит военную ветку мозга, поэтому не создаёт ни `▶`, ни `■`; налог остаётся `BOT_EASY_TAX`.

## Проверки

- Тесты `bot-brain`, `bot-brain-regressions`, `bot-actions-features`, `bot-determinism` — 18/18.
- `pnpm ai-check --changed` — OK (89 с).
- `pnpm verify` — `verify: OK (279 с)`; visual зелёный.

Следующая задача: `06/T1gd`.
