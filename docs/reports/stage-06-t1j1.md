# Отчёт 06/T1j1

## Сделано

- Исправлены замечания ревью в `packages/sim/src/bots/options/helpers.ts`: эффекты `cost`, `upkeep`, `income`, `strength`, `defense`, `supply` нормализуются относительно текущих показателей игрока; неполный `state` или `context` отбрасывается до обращения к производным данным.
- `upgradeCity` считает прирост через `cityGold` соседних уровней, а `improve` — через разницу лимитов `hexPopCap` до и после улучшения.
- Тесты `packages/sim/test/bot-options.test.ts` проверяют фиктивные definitions, нормализацию цены, обе формулы, частичный контекст и ненулевые эффекты всех девяти видов команд на игровом сценарии.

## Подтверждение

- Реестр девяти видов команд: `packages/sim/test/bot-options.test.ts:56-67` — 1/1.
- Расширяемость definitions: `packages/sim/test/bot-options.test.ts:70-81` — 1/1.
- Ненулевые эффекты всех видов, формулы, нормализация и защита состояния: `packages/sim/test/bot-options.test.ts:110-220` — 5/5.
- `pnpm --filter @hexfront/sim typecheck` — OK.
- `pnpm ai-check --changed` — OK (13 с).
- Полный `pnpm verify` — `verify: OK (278 с)`; лог `.ai-logs/verify-2026-10-09T04-57-05.log`.

Следующая задача: `$review 06/T1j1` в новой сессии.

## Ревью

Замечания исправлены: формулы используют фактический прирост, частичное состояние отбрасывается, а сценарий проверяет ненулевые эффекты всех видов команд.
