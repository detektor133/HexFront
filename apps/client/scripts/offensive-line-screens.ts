// Скриншоты 04/T14b «наступление только к линии» для отчёта этапа 04: фронт вокруг всей страны,
// линия восточнее — прямая, диагональная, изогнутая; без сопротивления (ничья земля); одни и те
// же сцены до и после (суффикс — вторым аргументом: before | after). Запуск при dev-сервере:
//   node --experimental-strip-types apps/client/scripts/offensive-line-screens.ts 5174 before
import { chromium, type Page } from '@playwright/test';

const PORT = process.argv[2] ?? '5173';
const SUFFIX = process.argv[3] ?? 'after';
/** Третий аргумент `arrows` — только стрелки: кадр в момент «Начать» и через 20 с наступления. */
const ARROWS_ONLY = process.argv[4] === 'arrows';
const ARROWS_WAIT_MS = 20_000;
const OUT = new URL('../../../docs/reports/stage-04/', import.meta.url);
/** Столица игрока 0 на карте small при сиде 42 (гекс 765, у левого края). */
const CAPITAL = 765;
const SCALE = 3;
const VIEW = { width: 1440, height: 900 };
const SCENE_SETTLE_MS = 2500;
/** Наступление идёт: за это время армия успевает взять линию целиком. */
const OFFENSIVE_WAIT_MS = 120_000;

type Point = { readonly x: number; readonly y: number };

const path = (name: string): string =>
  new URL(`${name}-${SUFFIX}.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');

const ARMY_CARD = { x: 90, y: 839 };
const TOOL_FRONT = { x: 43, y: 711 };
const TOOL_OFFENSIVE = { x: 89, y: 711 };
// Экранные точки при 1440×900: столица — (425, 450), свои гексы — она и два гекса западнее.
// Фронт — росчерк по кругу вокруг всей страны (палец привязывается к граням своей границы).
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
// Линии восточнее страны: прямая, диагональная (длинная косая), изогнутая.
const SCENES: readonly { name: string; line: Point[] }[] = [
  {
    name: 'straight',
    line: [
      { x: 760, y: 230 },
      { x: 760, y: 560 },
    ],
  },
  {
    name: 'diagonal',
    line: [
      { x: 640, y: 120 },
      { x: 860, y: 560 },
    ],
  },
  {
    name: 'curved',
    line: [
      { x: 690, y: 170 },
      { x: 790, y: 260 },
      { x: 830, y: 380 },
      { x: 800, y: 490 },
      { x: 740, y: 560 },
    ],
  },
];

async function stroke(page: Page, pts: readonly Point[], steps: number): Promise<void> {
  const [first, ...rest] = pts;
  if (!first) return;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y, { steps });
  await page.mouse.up();
}

async function scene(page: Page, line: readonly Point[]): Promise<void> {
  await page.goto(
    `http://localhost:${PORT}/dev/sandbox?map=small&select=${CAPITAL}&scale=${SCALE}`,
  );
  await page.getByText('1-я армия').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SCENE_SETTLE_MS);
  await page.keyboard.press('Escape');
  await page.mouse.click(ARMY_CARD.x, ARMY_CARD.y);
  await page.mouse.click(TOOL_FRONT.x, TOOL_FRONT.y);
  await stroke(page, FRONT_LOOP, 8);
  await page.waitForTimeout(6000);
  // Автоделение по фронту меняет выбор: карточка армии — переключатель, выбираем её, пока не
  // появится тулбар приказов армии.
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3 && (await page.locator('button').count()) < 8; i += 1) {
    await page.mouse.click(ARMY_CARD.x, ARMY_CARD.y);
    await page.waitForTimeout(200);
  }
  await page.mouse.click(TOOL_OFFENSIVE.x, TOOL_OFFENSIVE.y);
  await stroke(page, line, 20);
  await page.waitForTimeout(300);
  await page
    .getByRole('button', { name: /Начать/ })
    .first()
    .click();
  await page.mouse.move(1300, 800);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEW });
for (const s of SCENES) {
  await scene(page, s.line);
  await page.screenshot({ path: path(`offensive-line-${s.name}-start-1440x900`) });
  if (ARROWS_ONLY) {
    await page.waitForTimeout(ARROWS_WAIT_MS);
    await page.screenshot({ path: path(`offensive-line-${s.name}-20s-1440x900`) });
    continue;
  }
  await page.waitForTimeout(OFFENSIVE_WAIT_MS);
  await page.screenshot({ path: path(`offensive-line-${s.name}-1440x900`) });
}
await browser.close();
