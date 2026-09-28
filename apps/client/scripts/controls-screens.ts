// Скриншоты 04/T16 «кнопки наступления, "Удалить", жесты» для отчёта этапа 04 (песочница, сид 42,
// 1440×900): ▶/■ на карточке армии, прогноз без слов при наведении и при удержании, карточки
// отряда и города без подсказок-инструкций, набор — иконкой рода войск и числом.
// Запуск при работающем dev-сервере:
//   node --experimental-strip-types apps/client/scripts/controls-screens.ts 5174
import { chromium, type Page } from '@playwright/test';

import type { ForecastOutcome } from '../../../packages/sim/src/index.ts';
import { OUTCOME_ICON } from '../src/dev/forecast-icons.ts';
import { tokens } from '../src/theme/tokens.ts';

const PORT = process.argv[2] ?? '5173';
const OUT = new URL('../../../docs/reports/stage-04/', import.meta.url);
/** Столица игрока 0 на карте small при сиде 42 (гекс 765, у левого края). */
const CAPITAL = 765;
const SCALE = 3;
const SCENE_SETTLE_MS = 2500;

type Point = { readonly x: number; readonly y: number };

const path = (name: string): string =>
  new URL(`${name}-after.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');

// Экранные точки при 1440×900: столица — (425, 450); ничейный город с гарнизоном — (1025, 622).
const CAPITAL_AT = { x: 425, y: 450 };
const NEUTRAL_CITY = { x: 1025, y: 622 };
const HOLD_FROM = { x: 800, y: 450 };
const ARMY_CARD = { x: 90, y: 839 };
const TOOL_FRONT = { x: 43, y: 711 };
const TOOL_OFFENSIVE = { x: 89, y: 711 };
const FRONT_FROM = { x: 432, y: 407 };
const FRONT_TO = { x: 432, y: 497 };
const FRONT_LOOP: Point[] = [
  { x: 470, y: 400 },
  { x: 470, y: 500 },
  { x: 420, y: 510 },
  { x: 350, y: 545 },
  { x: 290, y: 490 },
  { x: 290, y: 410 },
  { x: 350, y: 355 },
  { x: 420, y: 395 },
];
/** Гекс северо-западнее столицы: после автоделения по фронту в нём один отряд армии. */
const ONE_UNIT = { x: 350, y: 407 };
const LINE: Point[] = [
  { x: 760, y: 230 },
  { x: 760, y: 560 },
];

async function open(page: Page): Promise<void> {
  await page.goto(
    `http://localhost:${PORT}/dev/sandbox?map=small&select=${CAPITAL}&scale=${SCALE}`,
  );
  await page.getByText('1-я армия').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SCENE_SETTLE_MS);
  await page.keyboard.press('Escape');
}

async function stroke(page: Page, pts: readonly Point[]): Promise<void> {
  const [first, ...rest] = pts;
  if (!first) return;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.up();
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 1. Линия наступления нарисована: ▶ и ■ на карточке армии, в тулбаре их нет.
await open(page);
await page.mouse.click(ARMY_CARD.x, ARMY_CARD.y);
await page.mouse.click(TOOL_FRONT.x, TOOL_FRONT.y);
await stroke(page, [FRONT_FROM, FRONT_TO]);
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
for (let i = 0; i < 3 && (await page.locator('button').count()) < 8; i += 1) {
  await page.mouse.click(ARMY_CARD.x, ARMY_CARD.y);
  await page.waitForTimeout(200);
}
await page.mouse.click(TOOL_OFFENSIVE.x, TOOL_OFFENSIVE.y);
await stroke(page, LINE);
await page.waitForTimeout(400);
await page.mouse.move(1300, 800);
await page.screenshot({ path: path('controls-card-run-1440x900') });

// 2. Наведение на ничейный город при выбранных отрядах — прогноз без слов.
await open(page);
await page.mouse.click(CAPITAL_AT.x, CAPITAL_AT.y);
await page.mouse.move(NEUTRAL_CITY.x - 20, NEUTRAL_CITY.y, { steps: 5 });
await page.mouse.move(NEUTRAL_CITY.x, NEUTRAL_CITY.y, { steps: 5 });
await page.waitForTimeout(300);
await page.screenshot({ path: path('controls-hover-forecast-1440x900') });

// 3. Удержание: цель под пальцем, ведём к городу — цель и прогноз переезжают (кадр до отпускания).
await open(page);
await page.mouse.click(CAPITAL_AT.x, CAPITAL_AT.y);
await page.mouse.move(HOLD_FROM.x, HOLD_FROM.y);
await page.mouse.down();
await page.waitForTimeout(500);
await page.mouse.move(NEUTRAL_CITY.x, NEUTRAL_CITY.y, { steps: 15 });
await page.waitForTimeout(300);
await page.screenshot({ path: path('controls-hold-target-1440x900') });
// Отмена — второй палец недоступен мыши: ведём обратно на фишку выбранных отрядов.
await page.mouse.move(CAPITAL_AT.x, CAPITAL_AT.y + 30, { steps: 15 });
await page.mouse.up();

// 4. Карточка отряда (выбрана часть армии): без «Разделить» и подсказки-инструкции.
await open(page);
await page.mouse.click(ARMY_CARD.x, ARMY_CARD.y);
await page.mouse.click(TOOL_FRONT.x, TOOL_FRONT.y);
await stroke(page, FRONT_LOOP);
await page.waitForTimeout(8000);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.mouse.click(ONE_UNIT.x, ONE_UNIT.y);
await page.waitForTimeout(300);
await page.mouse.move(1300, 800);
await page.screenshot({ path: path('controls-unit-card-1440x900') });

// 5. Карточка столицы (второй тап по тем же отрядам): набор — иконка рода войск и число.
await open(page);
await page.mouse.click(CAPITAL_AT.x, CAPITAL_AT.y);
await page.waitForTimeout(200);
await page.mouse.click(CAPITAL_AT.x, CAPITAL_AT.y);
await page.waitForTimeout(300);
await page.mouse.move(1300, 800);
await page.screenshot({ path: path('controls-city-card-1440x900') });

// 6. Три иконки исхода на плашке (та же геометрия и токены, что на карте) — на утверждение.
const plate = (o: ForecastOutcome, loss: string, zoom: number): string => {
  const color = {
    victory: tokens.status.success,
    stalemate: tokens.status.warning,
    defeat: tokens.status.danger,
  }[o];
  const lines = OUTCOME_ICON[o].map((l) => `<polyline points="${l.join(' ')}" />`).join('');
  return `<div class="plate" style="zoom:${zoom};border-color:${color}">
    <svg viewBox="0 0 14 14" style="stroke:${color}">${lines}</svg><span>${loss}</span></div>`;
};
const row = (zoom: number): string =>
  [
    plate('victory', '−12 %', zoom),
    plate('stalemate', '−41 %', zoom),
    plate('defeat', '−28 %', zoom),
  ].join('');
await page.setContent(`<style>
  body { margin: 24px; background: ${tokens.map.background}; font: 500 12px '${tokens.font.ui.family}', sans-serif; }
  .row { display: flex; gap: 24px; margin-bottom: 24px; align-items: center; }
  .plate { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px;
    background: ${tokens.ui.surface}; border: 1.2px solid; border-radius: 6px;
    box-shadow: 0 2px 0 rgba(34,33,30,0.14); color: ${tokens.ui.ink}; font-variant-numeric: tabular-nums; }
  svg { width: 14px; height: 14px; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
</style><div class="row">${row(4)}</div><div class="row">${row(1)}</div>`);
await page.setViewportSize({ width: 900, height: 260 });
await page.screenshot({ path: path('controls-forecast-icons') });
await browser.close();
