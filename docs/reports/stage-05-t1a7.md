# 05/T1a7 — протокол снимков песочницы

## Последовательность замороженного матча

Проверена последовательность `start(speed=0, fog=true) → observer(null) → fog(false) → select(0) → ack` без браузера через Vitest и `createLocalEngine`.

| Вариант | Последний снимок | `tick` | `fog` | `selection` |
| --- | --- | ---: | --- | ---: |
| Было | снимок после `observer(null)` | 2 | включён | отсутствует |
| Стало | снимок после `ack` | 0 | выключен | гекс 0 |

Старый результат был побочным эффектом `engine.tick()` в обработчике `observer`: он продвигал симуляцию и формировал снимок до обработки `fog(false)` и `select(0)`. Новый протокол создаёт стартовый снимок без продвижения, применяет изменения вида и выбора, затем отправляет их после `ack`.

## Visual

Эталоны `ui` и `match` обновлены после просмотра и одобрения владельца. `map-1440x900-dpr1.png` был изменён только из-за шума счётчика FPS и откатан.

Расхождение сохранилось только на песочнице: `ui` — 7,955 / 5,374 / 6,761 / 4,573 / 4,901 / 3,196 %, `match` — 13,565 / 12,678 / 9,411 / 8,340 / 4,934 / 3,630 % для viewport `390x844`, `844x390`, `1440x900` и DPR 1/3. `units` и `map` проходят.

Diff-PNG из последнего запуска:

- `apps/client/test-results/visual/ui-390x844-dpr1-diff.png`
- `apps/client/test-results/visual/ui-390x844-dpr3-diff.png`
- `apps/client/test-results/visual/ui-844x390-dpr1-diff.png`
- `apps/client/test-results/visual/ui-844x390-dpr3-diff.png`
- `apps/client/test-results/visual/ui-1440x900-dpr1-diff.png`
- `apps/client/test-results/visual/ui-1440x900-dpr3-diff.png`
- `apps/client/test-results/visual/match-390x844-dpr1-diff.png`
- `apps/client/test-results/visual/match-390x844-dpr3-diff.png`
- `apps/client/test-results/visual/match-844x390-dpr1-diff.png`
- `apps/client/test-results/visual/match-844x390-dpr3-diff.png`
- `apps/client/test-results/visual/match-1440x900-dpr1-diff.png`
- `apps/client/test-results/visual/match-1440x900-dpr3-diff.png`

Итоговая проверка: полный `pnpm verify` зелёный — build, types, lint, prettier, тесты и visual.
