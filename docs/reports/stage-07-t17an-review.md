# Ревью 07/T17an

Повторное ревью после `95d38897` завершено возвратом.

- СПЕК: `apps/client/test/t17an-radial-menu.test.ts:264-332` не проверяет удержание на фишке карты через `MatchSurfaceRuntime`/`setRadialHooks`: отсутствуют map pointerdown, ожидание `RADIAL_MENU_LONG_PRESS_MS`, pointerup над сектором и payload через `send`. Тест останется зелёным при удалении wiring `setRadialHooks`/`RadialHooks.action`.
- СПЕК: `apps/client/test/t17an-radial-menu.test.ts:264-306` создаёт `createMapView` отдельно и передаёт ему самостоятельно собранный `createDoubleTapHandler`, поэтому не проверяет wiring `useSandbox → createMapView(onDoubleTap)`. Тест останется зелёным при удалении передачи `onDoubleTap` из runtime или вызова `pick` в runtime.

Приёмочные проверки карточки, артиллерийских секторов и ПКМ не ослаблены. `pnpm verify --changed` — зелёный: build, types, tests.

Этап: 07/T17an
