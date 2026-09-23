# Статус

Обновляется агентом в конце каждой сессии. Читается в начале каждой сессии.

| Поле | Значение |
| --- | --- |
| Текущий этап | 01 — Фундамент |
| Текущая задача | T7 (заблокирована вопросами) |
| Ветка | `stage-01` |
| Последнее обновление | 2026-09-23 |

## Последняя сессия

- T1: монорепо (pnpm workspaces), строгий tsconfig, ESLint с правилами детерминизма `sim`, Prettier, dependency-cruiser с границами, Vitest (`test.projects`) с покрытием `sim` ≥ 90 %, CI, `tools/commit-check`. Dev-зависимости — ADR-0007.
- T2: fixed-point (`intDiv`, `floorDiv`, `fpMul`, `fpDiv`, `fp`, `clamp`) и гекс-математика; свойства fast-check, сверка с BigInt.
- T3: PRNG xoshiro128** (сверен с эталонным вектором), сид 42 зафиксирован, `fork`.
- T4: формат карты v1, загрузчик и валидатор, карты `tiny`/`small` (скрипт `pnpm --filter @hexfront/mapgen maps`), `balance.ts` целиком + тест сверки имён с `10-balance.md`.
- T5: `createMatch`, `hashState`, `step` с 17 пустыми системами, команды → `notImplemented`, сценарный DSL. Golden-хэш старта `small` (сид 42, 6 игроков): `ea697523`.
- T6: `tools/tokens` → `apps/client/src/theme/tokens.{ts,css}`, проверка устаревания в `pnpm check`, контраст палитры ≥ 4,5.
- `pnpm check` зелёный: 84 теста, покрытие `sim` 95 % строк.

## Дальше

T7 — клиент: Vite + PixiJS v8 + React 19, `/dev/map`, камера, шрифты. Перед началом — ответы на вопросы в `QUESTIONS.md` (размер гекса и зум, шрифты, замер fps). Для зависимостей клиента дописать ADR-0007. Затем отчёт `docs/reports/stage-01.md`.

## Блокеры и открытые вопросы

См. `QUESTIONS.md`: три вопроса блокируют T7, остальные — допущения агента на подтверждение.
