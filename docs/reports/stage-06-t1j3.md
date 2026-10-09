# Отчёт 06/T1j3

## Сделано

- `packages/sim/src/bots/brain.ts:19-35,130-137` принимает массив весов по id игрока и выбирает `weights.json` или `weights-easy.json` по уровню.
- `packages/sim/src/bots/run.ts:99-119` передаёт веса игрока в мозг; различие easy/medium осталось только в весах и `BOT_EASY_THINK_TICKS`.
- `packages/sim/src/bots/weights.json` и `packages/sim/src/bots/weights-easy.json` содержат одинаковые 43 ключа признаков, все значения равны нулю.
- Удалены старые константы мозга; тест-страж находится в `packages/sim/test/guards/bot-brain-source.test.ts:37-44`.
- `packages/sim/src/bots/options/helpers.ts:51-88` кэширует метрики игрока в пределах снимка тика; `packages/sim/src/bots/options/build.ts:29-50` считает снабжение по юнитам игрока, а не перебором всех гексов карты.

## Подтверждение

- `packages/sim/test/bot-weights.test.ts` — 4/4: разные веса двух ботов, смена налоговой ставки, одинаковые правила easy/medium при явных весах, смена решения ▶.
- `packages/sim/test/guards/bot-brain-source.test.ts` рекурсивно проверяет удалённые имена во всём `packages/sim/src`; вместе с `packages/sim/test/bot-determinism.test.ts` и тестом весов — 7/7.
- `pnpm --filter @hexfront/sim typecheck` — OK.
- `pnpm --filter @hexfront/evolve typecheck` — OK.
- `pnpm --filter @hexfront/bench full-match --players=30,100 --minutes=1` — 30 ботов: полный тик 5,801 мс, экономика 0,410 мс/бот/ход; 100 ботов: полный тик 30,417 мс, экономика 0,558 мс/бот/ход.
- `pnpm verify --changed` — `verify: OK (191 с)`.
- Полный `pnpm verify` — `verify: OK (297 с)`; лог `.ai-logs/verify-2026-10-09T09-24-41.log`.

## Исправление после ревью

- Тест-страж читает все TypeScript-файлы `packages/sim/src`, поэтому удалённые имена не могут остаться вне `balance.ts`.
- `pnpm vitest run packages/sim/test/guards/bot-brain-source.test.ts` — 2/2.
- `pnpm verify --changed` — `verify: OK (101 с)`.
- Полный `pnpm verify` — `verify: OK (291 с)`; лог `.ai-logs/verify-2026-10-09T09-44-40.log`.

Следующая задача: `$review 06/T1j3`.

## Возврат ревью 2026-10-09

- Пункт 3 не подтверждён тестом-стражем: `packages/sim/test/guards/bot-brain-source.test.ts:39-44` читает только `balance.ts`, хотя критерий требует проверять отсутствие удалённых имён во всём `packages/sim/src`.
- Обязательный замер ревью: 30 ботов — полный тик 1,700 мс, экономика 0,387 мс/бот/ход; 100 ботов — полный тик 10,677 мс, экономика 0,533 мс/бот/ход; бюджет T1j3 для 30 ботов выполнен.

## Приёмка ревью 2026-10-09

- Все критерии подтверждены: `packages/sim/test/bot-weights.test.ts`, `packages/sim/test/guards/bot-brain-source.test.ts`, `packages/sim/test/bot-determinism.test.ts` — 7/7.
- `pnpm --filter @hexfront/sim typecheck` и `pnpm --filter @hexfront/evolve typecheck` — OK.
- Тест-страж рекурсивно проверяет все TypeScript-файлы `packages/sim/src`; запрещённых имён в исходном коде нет.
- Обязательный замер: 30 ботов — полный тик 1,606 мс, экономика 0,370 мс/бот/ход; 100 ботов — полный тик 10,351 мс, экономика 0,505 мс/бот/ход. Критерий 30 ботов ≤ 15 мс и экономика ≤ 0,508 мс/бот/ход выполнен.
- Golden commander не изменены. T1j3 принята ревью.

## Возврат ревью 2026-10-09

- CI run `37914771059` завершился ошибкой: `packages/sim/test/guards/bot-brain-source.test.ts:49` получает `ENOTDIR` для `packages/sim/src/balance.ts/` на Linux.
- Причина: `simSourceFiles` строит URL с завершающим `/` и для файлов, и для директорий. Локальный Windows-прогон не выявляет платформенную ошибку.
- T1j3 возвращена до исправления теста-стража; код и тесты в ревью не изменялись.
