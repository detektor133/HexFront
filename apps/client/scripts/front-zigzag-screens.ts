// Скриншот 04/T14a «фронт без зигзага» для отчёта этапа 04: росчерк инструментом «Фронт» из
// середины северо-восточной стороны столицы вверх и обратно вниз (песочница, сид 42, 1440×900).
// Запуск при работающем dev-сервере:
//   node --experimental-strip-types apps/client/scripts/front-zigzag-screens.ts 5174 after
import { chromium } from '@playwright/test';

const PORT = process.argv[2] ?? '5173';
const SUFFIX = process.argv[3] ?? 'after';
const OUT = new URL('../../../docs/reports/stage-04/', import.meta.url);
/** Столица игрока 0 на карте small при сиде 42 (гекс 765, у левого края). */
const CAPITAL = 765;
const SCALE = 3;
const SCENE_SETTLE_MS = 2500;

const path = (name: string): string =>
  new URL(`${name}-${SUFFIX}.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');

const ARMY_CARD = { x: 90, y: 839 };
const TOOL_FRONT = { x: 43, y: 711 };
// Середина северо-восточной стороны → вверх → вниз мимо середины.
const STROKE = [
  { x: 470, y: 450 },
  { x: 432, y: 407 },
  { x: 470, y: 450 },
  { x: 432, y: 497 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:${PORT}/dev/sandbox?map=small&select=${CAPITAL}&scale=${SCALE}`);
await page.getByText('1-я армия').first().waitFor();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(SCENE_SETTLE_MS);
await page.keyboard.press('Escape');
await page.mouse.click(ARMY_CARD.x, ARMY_CARD.y);
await page.mouse.click(TOOL_FRONT.x, TOOL_FRONT.y);
const [first, ...rest] = STROKE;
if (first) {
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y, { steps: 10 });
  await page.mouse.up();
}
await page.waitForTimeout(500);
await page.screenshot({ path: path('front-zigzag-1440x900') });
await browser.close();
