# Ревью 07/T17an

Повторное ревью после `95d38897` завершено возвратом.

- СПЕК: `apps/client/test/t17an-radial-menu.test.ts:264-332` не проверяет удержание на фишке карты через `MatchSurfaceRuntime`/`setRadialHooks`: отсутствуют map pointerdown, ожидание `RADIAL_MENU_LONG_PRESS_MS`, pointerup над сектором и payload через `send`. Тест останется зелёным при удалении wiring `setRadialHooks`/`RadialHooks.action`.
- СПЕК: `apps/client/test/t17an-radial-menu.test.ts:264-306` создаёт `createMapView` отдельно и передаёт ему самостоятельно собранный `createDoubleTapHandler`, поэтому не проверяет wiring `useSandbox → createMapView(onDoubleTap)`. Тест останется зелёным при удалении передачи `onDoubleTap` из runtime или вызова `pick` в runtime.

Приёмочные проверки карточки, артиллерийских секторов и ПКМ не ослаблены. `pnpm verify --changed` — зелёный: build, types, tests.

Новый блокер после `95d38897`:

- СПЕК: `apps/client/test/t17an-radial-menu.test.ts:290-306,311-316` не сравнивает центр map-меню с координатами `pointerdown`; тест остаётся зелёным при смещённом `center`, потому что `menuPoint` использует фактическое положение меню.

Этап: 07/T17an

## Исправление после `1a7ca1c`

Оба сценария проходят через смонтированный `MatchSurface`: map long-press проверяет payload `send`, двойной тап — выбор армии и `centerOn` с длительностью 250 мс. Целевой тест 9/9 и `pnpm verify --changed` зелёные.

## Повторное ревью после `4b3f1ea`

OK — тест через реальный `MatchSurface`/`MapView` проверяет координаты фишки и точную длительность анимации: после половины `tokens.motion.map` камера не достигла цели, после полного значения достигла. Приёмочные сценарии радиального меню, отмены, карточки `UnitCard` и регрессии ПКМ сохранены. `pnpm verify --changed` — зелёный.

Этап: 07/T17an
