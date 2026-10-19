# 07/T17u — исправление возврата ревью

2026-10-19. Исправлены восемь пунктов последнего возврата. Механики, баланс и правила UI не менялись.

## Код продукта

`apps/client/src/dev/Leaderboard.tsx` запрашивает наблюдение border-box и передаёт `borderBoxSize` в раскладку. При отсутствии этого поля к `contentRect` прибавляются вычисленные padding и рамки по обеим осям. Начальное измерение остаётся внешним `getBoundingClientRect`. Размер больше не занижается на 14 px.

## Пункты возврата

| Пункт | Исправление и подтверждение |
| --- | --- |
| 1. Content-box вместо внешнего размера | `apps/client/test/t17i-leaderboard-layout.test.ts`: настоящий `MatchPage → MatchSurface → layout → Leaderboard`, исходные CSS-модули, событие 173×139 преобразуется во внешние 187×153. Отдельная высота content-box 95 px даёт внешние 109 px и пересечение с popup; передача 95 px без padding/рамок оставляет панель на 8 px вместо 236 px. На трёх ПК-разрешениях проверены обе оси, сохранены мобильные сценарии. Геометрия Leaderboard и прототип `getBoundingClientRect` не подменяются; управляется только входной якорь кнопки налога. `leaderboard.dom.test.tsx` дополнительно проверяет обе ветки: borderBoxSize и contentRect. |
| 2. Обратная связь высот | `apps/client/test/t17q-army-bar-anchor.dom.test.tsx` и `t17q-resize.ts`: различаются внутреннее содержимое, CSS-padding/рамка, назначенная внешняя высота и растягивание внутреннего элемента. Getter остаётся динамическим после каждого уведомления. Проверены повторные уведомления после назначения стиля, обновление `view.armies`, увеличение и уменьшение высоты, четыре inline-свойства, нижний край ArmyBar и одна подписка на её mount/unmount; подписки карточек также сбалансированы. HexCard имеет внешнюю высоту 114 = 88 + 24 + 2 px и не растёт при повторных уведомлениях. |
| 3. Геометрические transitions | `t17q-army-bar-anchor.dom.test.tsx`, `t17o-scrollbar-motion.dom.test.tsx` и общий `panel-css.ts` подключают исходные CSS к настоящим именам классов модулей. Проверяются dock/bottom-panel, внутренний ArmyBar, HexCard и Leaderboard. CSSOM учитывает shorthand, `all`, отдельные transition-property/duration и списки длительностей; фиктивная браузерная раскладка не нужна. |
| 4. Прокрутка и обрезание | `t17o-scrollbar-motion.dom.test.tsx`: overflow, overflow-x и overflow-y всей ПК-панели допускают только исходное/visible. Запрещены hidden, clip, auto и scroll. Независимые auto-прокрутка HexCard, отсутствие её нативного скроллбара и ширина сохранены. |
| 5. Сортировка и отображаемые места | `leaderboard.dom.test.tsx`: обратный порядок id, несортированные по убыванию очки, конфликтующие игровые place 10–39. Проверяются точные пять строк, порядок id при ничьих, отображаемые ранги 1/1/3/3/5 и неизменность исходного ranking и me.place. |
| 6. Полный большой счёт | `leaderboard.dom.test.tsx`: в строке с длинным ником показан весь счёт 123456789; имя и title сохранены, CSS многоточия применяется к нику, обрезание счёта запрещено по обеим осям. |
| 7. Видимые заголовок и «Живы» | `leaderboard.dom.test.tsx` и `t17d-leaderboard.dom.test.tsx`: кроме текста проверяется `isInaccessible === false`; скрытие каждого текста атрибутом hidden обнаруживается обоими файлами. Сохранены три поля и лимит пяти строк. |
| 8. Координаты при налоге | `t17j-tax-leaderboard.dom.test.tsx`: до открытия, после открытия, изменения и закрытия налога сравниваются действующие left/right/top/bottom/width/height строками. Наличие числовых активных координат проверяется отдельно; NaN нет. Исходный fallback right равен 16px, тот же DOM-узел сохраняется. |

## RED/GREEN

Для каждой строки временно внесена указанная регрессия в продукт, получено падение assertion, затем исходные байты полностью восстановлены и та же команда стала зелёной. Мутации не включены в коммит.

Команда каждой строки: `pnpm exec vitest run apps/client/test/<файл из таблицы>`. Для скрытых текстов команда содержит оба перечисленных файла. Число GREEN — число прошедших тестов этой команды.

| Временная регрессия | Целевой тест | RED → GREEN |
| --- | --- | --- |
| Передать entry.contentRect целиком | t17i-leaderboard-layout.test.ts | left 1177 вместо 1163 → 5/5 |
| Передать только contentRect.height, сохранив правильную ширину | t17i-leaderboard-layout.test.ts | top 8 вместо 236 → 5/5 |
| ArmyBar: скопировать parent.style.height во внутренний элемент перед измерением | t17q-army-bar-anchor.dom.test.tsx | высота осталась 220 вместо 160 → 8/8 |
| HexCard: растянуть внутренний элемент высотой внешнего | t17q-army-bar-anchor.dom.test.tsx | дрейф inline-координат → 8/8 |
| Измерять card.scrollHeight вместо content.scrollHeight | t17q-army-bar-anchor.dom.test.tsx | внешняя высота 138 вместо 114 → 8/8 |
| ArmyBar .dock: transition top 1s | t17q-army-bar-anchor.dom.test.tsx | длительность 1 вместо 0 → 8/8 |
| Leaderboard .panel: transition all 1s | t17o-scrollbar-motion.dom.test.tsx | длительность 1 вместо 0 → 4/4 |
| HexCard: отдельные transition-property height и duration 1s | t17o-scrollbar-motion.dom.test.tsx | длительность 1 вместо 0 → 4/4 |
| ArmyBar .dock: отдельные transition-property all и duration 1s | t17q-army-bar-anchor.dom.test.tsx | длительность 1 вместо 0 → 8/8 |
| ArmyBar .content: transition top 1s | t17o-scrollbar-motion.dom.test.tsx | длительность 1 вместо 0 → 4/4 |
| Leaderboard: properties opacity/top, durations 0s/1s | t17o-scrollbar-motion.dom.test.tsx | длительность top 1 вместо 0 → 4/4 |
| Leaderboard overflow-y hidden | t17o-scrollbar-motion.dom.test.tsx | hidden не разрешён → 4/4 |
| Leaderboard overflow-y clip | t17o-scrollbar-motion.dom.test.tsx | clip не разрешён → 4/4 |
| Leaderboard overflow-x auto | t17o-scrollbar-motion.dom.test.tsx | auto не разрешён → 4/4 |
| Leaderboard overflow-x scroll | t17o-scrollbar-motion.dom.test.tsx | scroll не разрешён → 4/4 |
| Leaderboard overflow hidden | t17o-scrollbar-motion.dom.test.tsx | hidden не разрешён → 4/4 |
| Сортировать по игровому place | leaderboard.dom.test.tsx | неверный первый игрок/порядок → 8/8 |
| Вывести игровой row.place | leaderboard.dom.test.tsx | 39/38/37/36/35 вместо 1/1/3/3/5 → 8/8 |
| Обратный id при равных очках | leaderboard.dom.test.tsx | нарушен точный порядок строк → 8/8 |
| Сократить score ≥ 1000 до трёх цифр | leaderboard.dom.test.tsx | 123 вместо 123456789 → 8/8 |
| hidden у h2 | leaderboard.dom.test.tsx, t17d-leaderboard.dom.test.tsx | isInaccessible true → 12/12 |
| hidden у p | leaderboard.dom.test.tsx, t17d-leaderboard.dom.test.tsx | isInaccessible true → 12/12 |
| При popupOpen сменить только fallback right на 0px | t17j-tax-leaderboard.dom.test.tsx | right 0px вместо 16px → 4/4 |

Итого 23 различные мутации; проверка content-box повторена после усиления сценария вертикального пересечения.

## Остальная приёмка T17u

- Шесть исправленных файлов тестов: 33 теста прошли. Независимые проверки обновления рейтинга, HUD и мобильных сценариев сохранены.
- Дополнительная команда `pnpm exec vitest run` для `army-bar-layout.dom.test.tsx`, `t17l-army-bar.dom.test.tsx`, `t17m-hex-card.dom.test.tsx`, `t17t-hud-tax.dom.test.tsx`, `match-layout.dom.test.tsx`, `mobile-labels.dom.test.tsx`, `leaderboard.test.ts`: 45/45. Подтверждены 238 px/box-sizing карточки, колесо до последней армии, действия карточек и приказов, правила pointer-events пустоты, полное значение налога, изменение якоря popup, остальные inline-прямоугольники, пауза, выбор и мобильные подписи.
- Общие настройки CSS и модель ResizeObserver вынесены в вспомогательные файлы без дублирования; файл T17q меньше 400 строк.
- `pnpm verify --changed`: сборка, типы, lint, форматирование и 101 тест в 18 файлах зелёные; итог `verify: OK (36 с)`.
- Проверит владелец (раунды замечаний этапа): фактическая картинка, многоточие, размеры и перекрытия на опубликованной сборке — jsdom не вычисляет браузерную раскладку. T17 остаётся `[ ]`.
- CI исходного HEAD зелёный; CI нового коммита проверяется в начале следующей сессии по `$task`.
