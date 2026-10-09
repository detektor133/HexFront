# Отчёт 06/T1j4

## Сделано

- `packages/sim/src/bots/run.ts:39-103` передаёт commander веса по id игрока и выбирает профиль `easy`/`medium` через общий резолвер весов.
- `packages/sim/src/bots/commander.ts:157-181,316-333` использует `commander.mergeBelowSoldiers` и `commander.mergeRadius`; отрицательные значения ограничиваются нулём, порог переводится из солдат в fixed-point.
- `packages/sim/src/bots/weights.json` и `packages/sim/src/bots/weights-easy.json` содержат параметры commander со стартовыми значениями 25 и 3.
- `BOT_MERGE_BELOW` и `BOT_MERGE_RADIUS` удалены из `balance.ts`; тест-страж проверяет отсутствие имён во всём `packages/sim/src`.
- Путь людей не получает веса и вызывает прежнюю commander-логику; golden-файлы не изменялись.

## Подтверждение

- `packages/sim/test/scenarios/commander.test.ts` — 18/18: отрицательные параметры дают нулевой порог и радиус; существующие сценарии commander и human-путь сохранены.
- `packages/sim/test/guards/bot-brain-source.test.ts` — 2/2: удалённых `BOT_MERGE_*` в исходниках нет.
- `pnpm --filter @hexfront/sim typecheck` — OK.
- `pnpm ai-check --changed` — OK (100 с).
- `pnpm --filter @hexfront/bench full-match --players=30,100 --minutes=1`: 30 ботов — полный тик 1,757 мс, commander 0,084 мс/бот/ход; 100 ботов — полный тик 10,930 мс, commander 0,299 мс/бот/ход. Оба показателя ниже порогов T1j4.
- Полный `pnpm verify` — `verify: OK (296 с)`; лог `.ai-logs/verify-2026-10-09T10-29-43.log`.

Следующая задача: 06/T1j5.
