# Отчёт 05/T7

## Трассировка

| Критерий | Подтверждение |
| --- | --- |
| Пять контекстных подсказок | `apps/client/src/match/onboarding.ts` содержит `autoCommand`, `tax`, `foundCity`, `front`, `offensive`; `apps/client/test/onboarding.test.ts`: 2/2 |
| Появляются по ситуации | `availableOnboardingHints` фильтрует подсказки по снимку `PlayerView`; тест подтверждает исключение недоступной ситуации |
| Отключаемые | Кнопка «Понятно» скрывает текущую подсказку, «Скрыть подсказки» сохраняет все пять в `localStorage`; тест подтверждает отсутствие отключённых подсказок |
| Только первый матч | `MatchPage` передаёт `showOnboarding`, dev-маршруты подсказки не получают; `pnpm visual` — все эталоны прошли |

## Проверки

- `pnpm vitest run apps/client/test/onboarding.test.ts` — 2/2.
- `pnpm ai-check --changed` — OK за 14 с.
- `pnpm verify` — `verify: OK (287 с)`; visual прошёл.
