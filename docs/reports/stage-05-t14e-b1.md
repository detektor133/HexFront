# Отчёт 05/T14e-Б1 — сторож синхронизации индекса

## Сделано

- Добавлены `addUnit`, `moveUnit` и `removeUnits`: изменение `state.units`, `unit.hex` и производного индекса выполняется одной операцией в `state/unit-index.ts`.
- В `eslint.config.js` добавлен `no-restricted-syntax` для прямых `unit.hex` и `state.units.push`/`splice`/`filter` в `packages/sim/src`; тестовые сценарии удаляют отряды через DSL.
- `indexMatchesUnits` получил диагностику `unitIndexMismatch` с гексом и id отряда.
- Сценарный DSL и golden-реплеи `development`/`war` проверяют индекс после каждого `step`.

## Проверки

| Критерий | Результат |
| --- | --- |
| ESLint запрещает обход единого модуля | выполнен: lint в полном `pnpm verify` не допускает прямые мутации в `packages/sim/src` |
| DSL и golden-тесты проверяют индекс после каждого `step` | выполнен: проверки добавлены в DSL и оба golden-реплея |
| При рассинхронизации выводятся гекс и id отряда | выполнен: `unitIndexMismatch` формирует сообщение `гекс N, отряд ID` |
| Golden-хэши не меняются | выполнен: полный `pnpm verify` прошёл без изменения эталонов |

`pnpm verify`: `verify: OK (273 с)`; build, типы, lint, prettier, тесты и visual прошли.
