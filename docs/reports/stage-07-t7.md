# Отчёт 07/T7 — исправление возврата ревью

## Результат

- Приёмочный тест теперь прогоняет стартовую подсказку, выбранный гекс, выбранную армию, лидерборд и меню паузы на 390×844, 844×390 и 1440×900.
- Каждый прогон рендерит `MatchPage`/`MatchSurface` с реальным `PlayerView`; `validateMatchLayout` получает состав элементов отрендеренной сцены.
- Для альбомного HUD `11px` заменено на `var(--font-size-caption)`, поэтому подписи не меньше 12 px.

## Проверка

- `pnpm verify --changed` — зелёный: build, types, lint, prettier, tests, visual.
- Визуальные эталоны текущего раннера: `apps/client/tests/visual/baseline/match-390x844-dpr1.png`, `match-390x844-dpr3.png`, `match-844x390-dpr1.png`, `match-844x390-dpr3.png`, `match-1440x900-dpr1.png`, `match-1440x900-dpr3.png`.
- `rg -n "top:\s*(52px|56px|72px)" apps/client/src --glob '*.css' --glob '*.ts' --glob '*.tsx'` — совпадений нет.

## Повторное ревью — возврат

- `apps/client/test/match-layout.test.ts:346-367` не перебирает `popupOpen`, `paused`, `eventRows = 0` и `cardHeight = 120`, поэтому fast-check слабее критериев задачи.
- `apps/client/test/match-layout.test.ts:270-317` монтирует меню паузы отдельно и проверяет расчёт с `paused: false`, поэтому не подтверждает реальный путь.
- `apps/client/src/match/MatchSurface.tsx:79-90` передаёт константные высоты вместо измеренных `ResizeObserver`; `cardHeight` также зафиксирован числом.
- `apps/client/src/match/PauseMenu.module.css:14` сдвигает уже рассчитанный левый верхний угол через `translate(-50%, -50%)`.

## Возврат ревью

- `apps/client/test/match-layout.test.ts:187-226,338-345` проверяет вручную собранный снимок с жёсткими координатами, а не измеренную раскладку `MatchSurface`.
- `apps/client/test/match-layout.test.ts:320-334` не открывает реальные состояния лидерборда и меню паузы: `PauseMenu` монтируется отдельно от `MatchPage`.
- `apps/client/tests/visual/visual-check.ts:40-50` снимает для `/match` одну сцену вместо пяти сцен T7.

## Что требуется исправить

- Следующая проверка — `$review 07/T7`; отдельный браузерный просмотр запрещён правилами проекта.
