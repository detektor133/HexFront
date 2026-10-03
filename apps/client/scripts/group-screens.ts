// Скриншоты 04/T15 «группы движения и выбор» для отчёта этапа 04 (песочница, сид 42, 1440×900):
// стопка отрядов на марше — одна фишка с цифрой, выбраны отряды — золотые рамки фишек без
// подсветки гекса, армия выбрана сама; выбрана часть армии — тонкая рамка карточки.
// Запуск при работающем dev-сервере:
//   node --experimental-strip-types apps/client/scripts/group-screens.ts 5174
import { chromium, type Page } from '@playwright/test';

const PORT = process.argv[2] ?? '5173';
const OUT = new URL('../../../docs/reports/stage-04/', import.meta.url);
/** Столица игрока 0 на карте small при сиде 42 (гекс 765, у левого края). */
const CAPITAL = 765;
const SCALE = 3;
const SCENE_SETTLE_MS = 2500;

type Point = { readonly x: number; readonly y: number };

const path = (name: string): string =>
  new URL(`${name}-after.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');

// Экранные точки при 1440×900: столица — (425, 450), свои гексы — она и два гекса западнее.
const CAPITAL_AT = { x: 425, y: 450 };
const MARCH_TO = { x: 800, y: 450 };
const ARMY_CARD = { x: 90, y: 839 };
const TOOL_FRONT = { x: 43, y: 711 };
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

async function open(page: Page): Promise<void> {
  await page.goto(
    `http://localhost:${PORT}/dev/sandbox?map=small&select=${CAPITAL}&scale=${SCALE}`,
  );
  await page.getByText('1-я армия').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SCENE_SETTLE_MS);
  await page.keyboard.press('Escape');
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 1. Все отряды столицы — марш на восток: одна фишка с цифрой на пути.
await open(page);
await page.mouse.click(CAPITAL_AT.x, CAPITAL_AT.y);
await page.mouse.click(MARCH_TO.x, MARCH_TO.y, { button: 'right' });
await page.waitForTimeout(3500);
await page.mouse.move(1300, 800);
await page.screenshot({ path: path('group-march-1440x900') });

// 2. Фронт вокруг страны, армия делится; выбран один отряд — часть армии.
await open(page);
await page.mouse.click(ARMY_CARD.x, ARMY_CARD.y);
await page.mouse.click(TOOL_FRONT.x, TOOL_FRONT.y);
const [first, ...rest] = FRONT_LOOP;
if (first) {
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.up();
}
await page.waitForTimeout(8000);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.mouse.click(ONE_UNIT.x, ONE_UNIT.y);
await page.waitForTimeout(300);
await page.mouse.move(1300, 800);
await page.screenshot({ path: path('group-partial-1440x900') });
await browser.close();
