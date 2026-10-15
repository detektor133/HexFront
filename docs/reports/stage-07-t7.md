# Отчёт 07/T7 — исправление возврата ревью

## Результат

- Приёмочный тест теперь прогоняет стартовую подсказку, выбранный гекс, выбранную армию, лидерборд и меню паузы на 390×844, 844×390 и 1440×900.
- Каждый прогон рендерит `MatchPage`/`MatchSurface` с реальным `PlayerView`; `validateMatchLayout` получает состав элементов отрендеренной сцены.
- Для альбомного HUD `11px` заменено на `var(--font-size-caption)`, поэтому подписи не меньше 12 px.

## Проверка

- `pnpm verify --changed` — зелёный: build, types, lint, prettier, tests, visual.
- Визуальные эталоны текущего раннера: `apps/client/tests/visual/baseline/match-390x844-dpr1.png`, `match-390x844-dpr3.png`, `match-844x390-dpr1.png`, `match-844x390-dpr3.png`, `match-1440x900-dpr1.png`, `match-1440x900-dpr3.png`.
- `rg -n "top:\s*(52px|56px|72px)" apps/client/src --glob '*.css' --glob '*.ts' --glob '*.tsx'` — совпадений нет.

## Что требуется исправить

- Следующая проверка — `$review 07/T7`; отдельный браузерный просмотр запрещён правилами проекта.
