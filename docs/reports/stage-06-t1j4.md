# Отчёт 06/T1j4

## Сделано

- `packages/sim/src/bots/run.ts:39-103` передаёт commander веса по id игрока и выбирает профиль `easy`/`medium` через общий резолвер весов.
- `packages/sim/src/bots/commander.ts:157-181,316-333` использует `commander.mergeBelowSoldiers` и `commander.mergeRadius`; отрицательные значения ограничиваются нулём, порог переводится из солдат в fixed-point.
- `packages/sim/src/bots/weights.json` и `packages/sim/src/bots/weights-easy.json` содержат параметры commander со стартовыми значениями 25 и 3.
- `BOT_MERGE_BELOW` и `BOT_MERGE_RADIUS` удалены из `balance.ts`; тест-страж проверяет отсутствие имён во всём `packages/sim/src`.
- Путь людей не получает веса и вызывает прежнюю commander-логику; golden-файлы не изменялись.

## Подтверждение

- `packages/sim/test/scenarios/commander.test.ts` — 18/18: отрицательные параметры дают нулевой порог и радиус; отсутствующие параметры не получают fallback; существующие сценарии commander и human-путь сохранены.
- Регрессионный тест на пустые веса подтверждает, что отсутствующие `commander.*` не получают балансный fallback и дают нулевые параметры.
- `packages/sim/test/guards/bot-brain-source.test.ts` — 2/2: удалённых `BOT_MERGE_*` в исходниках нет.
- `pnpm --filter @hexfront/sim typecheck` — OK.
- `pnpm ai-check --changed` — OK (100 с).
- Профильные тесты после исправления — 20/20.
- `pnpm --filter @hexfront/bench full-match --players=30,100 --minutes=1`: 30 ботов — полный тик 1,720 мс, commander 0,082 мс/бот/ход; 100 ботов — полный тик 10,958 мс, commander 0,301 мс/бот/ход. Оба показателя ниже порогов T1j4.
- `pnpm verify --changed` — `verify: OK (186 с)`; лог `.ai-logs/verify-2026-10-12T01-26-51.log`.
- Полный `pnpm verify` — `verify: OK (283 с)`; лог `.ai-logs/verify-2026-10-12T01-31-03.log`.

## Исправление после ревью

- `packages/sim/src/bots/run.ts:86-89` больше не дублирует значения 25 и 3: отсутствующие ключи весов получают нулевые параметры, а штатные начальные значения остаются только в JSON-весах.
- `packages/sim/test/scenarios/commander.test.ts:281-298` добавляет регрессионную проверку пустых весов.

Следующая задача: 06/T1j5.

## Ревью 2026-10-12

- Все четыре критерия подтверждены: профильные тесты — 20/20, typecheck — OK, тест-страж удалённых констант — OK.
- Human-путь и golden-файлы не изменены; `commanderCommands` передаёт веса бота по id игрока, отрицательные и отсутствующие параметры дают нулевые порог и радиус.
- Обязательный benchmark: 30 ботов — полный тик 1,69 мс, commander 0,080 мс/бот/ход; 100 ботов — полный тик 10,782 мс, commander 0,297 мс/бот/ход. Пороги T1j4 соблюдены.
