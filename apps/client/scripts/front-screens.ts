// Скриншоты 04/T13 «фронт без скачков» для отчёта этапа 04: фронт по северо-восточной стороне
// столицы до и после захвата соседнего гекса у его конца (песочница, сид 42).
// Запуск при работающем dev-сервере (порт — аргументом, по умолчанию 5173):
//   node --experimental-strip-types apps/client/scripts/front-screens.ts 5174
import { chromium, type Page } from '@playwright/test';

const PORT = process.argv[2] ?? '5173';
const OUT = new URL('../../../docs/reports/stage-04/', import.meta.url);
/** Столица игрока 0 на карте small при сиде 42 (гекс 765, у левого края). */
const CAPITAL = 765;
const SCALE = 3;
const SCENE_SETTLE_MS = 2500;
/** Отряд доходит до соседних холмов и берёт гекс. */
const CAPTURE_WAIT_MS = 25_000;

const path = (name: string): string =>
  new URL(`${name}.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');

// Экранные точки при 1440×900 и масштабе 3: столица у левого края карты.
const ARMY_CARD = { x: 90, y: 839 };
const TOOL_FRONT = { x: 43, y: 711 };
const FRONT_FROM = { x: 432, y: 407 };
const FRONT_TO = { x: 432, y: 497 };
const CHIP = { x: 434, y: 481 };
const TARGET = { x: 504, y: 396 };

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:${PORT}/dev/sandbox?map=small&select=${CAPITAL}&scale=${SCALE}`);
await page.getByText('1-я армия').first().waitFor();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(SCENE_SETTLE_MS);
await page.keyboard.press('Escape');
// Армия → «Фронт» → провести по северо-восточной стороне столицы.
await page.mouse.click(ARMY_CARD.x, ARMY_CARD.y);
await page.mouse.click(TOOL_FRONT.x, TOOL_FRONT.y);
await drag(page, FRONT_FROM, FRONT_TO);
await page.waitForTimeout(500);
await page.screenshot({ path: path('front-follow-1440x900-before') });
// Отряды армии — в соседние холмы у конца фронта (ПКМ — приказ сразу).
await page.keyboard.press('Escape');
await page.mouse.click(CHIP.x, CHIP.y);
await page.mouse.click(TARGET.x, TARGET.y, { button: 'right' });
await page.keyboard.press('Escape');
await page.waitForTimeout(CAPTURE_WAIT_MS);
await page.screenshot({ path: path('front-follow-1440x900-after') });
await browser.close();
