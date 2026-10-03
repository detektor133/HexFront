// Скриншоты 04/T14 «линия наступления — гладкая, без петель» для отчёта этапа 04: одни и те же
// сцены до исправления и после (суффикс — вторым аргументом: before | after).
// Запуск при работающем dev-сервере:
//   node --experimental-strip-types apps/client/scripts/offensive-screens.ts 5174 before
import { existsSync, readFileSync } from 'node:fs';

import { chromium, type Page } from '@playwright/test';

const PORT = process.argv[2] ?? '5173';
const SUFFIX = process.argv[3] ?? 'after';
const OUT = new URL('../../../docs/reports/stage-04/', import.meta.url);
/** Столица игрока 0 на карте small при сиде 42 (гекс 765, у левого края). */
const CAPITAL = 765;
const SCALE = 3;
const VIEW = { width: 1440, height: 900 };
const SCENE_SETTLE_MS = 2500;

const path = (name: string): string =>
  new URL(`${name}-${SUFFIX}.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');

const ARMY_CARD = { x: 90, y: 839 };
const TOOL_FRONT = { x: 43, y: 711 };
const TOOL_OFFENSIVE = { x: 89, y: 711 };
const FRONT_FROM = { x: 432, y: 407 };
const FRONT_TO = { x: 432, y: 497 };

/** Росчерк по точкам; steps — промежуточных движений мыши на отрезок (быстрый палец — мало). */
async function stroke(page: Page, pts: readonly Point[], steps: number): Promise<void> {
  const [first, ...rest] = pts;
  if (!first) return;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y, { steps });
  await page.mouse.up();
}

async function open(page: Page): Promise<void> {
  await page.goto(
    `http://localhost:${PORT}/dev/sandbox?map=small&select=${CAPITAL}&scale=${SCALE}`,
  );
  await page.getByText('1-я армия').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SCENE_SETTLE_MS);
  await page.keyboard.press('Escape');
  // Армия → «Фронт» по северо-восточной стороне столицы → «Наступление».
  await page.mouse.click(ARMY_CARD.x, ARMY_CARD.y);
  await page.mouse.click(TOOL_FRONT.x, TOOL_FRONT.y);
  await stroke(page, [FRONT_FROM, FRONT_TO], 12);
  await page.waitForTimeout(300);
  await page.mouse.click(TOOL_OFFENSIVE.x, TOOL_OFFENSIVE.y);
}

type Point = { readonly x: number; readonly y: number };

// Сцены в экранных точках при 1440×900: столица — (425, 450), радиус гекса на экране — 50 px;
// восточнее столицы — ничья равнина. Палец привязывается к ближайшим углам гексов.
const SCENES: readonly { name: string; pts: Point[]; steps: number; start?: boolean }[] = [
  // Быстрый диагональный росчерк: между соседними замерами пальца — несколько углов.
  {
    name: 'offensive-diagonal',
    pts: [
      { x: 640, y: 230 },
      { x: 870, y: 580 },
    ],
    steps: 4,
  },
  // Вперёд на 4 гекса и назад на 2 по той же границе.
  {
    name: 'offensive-back',
    pts: [
      { x: 640, y: 200 },
      { x: 940, y: 200 },
      { x: 790, y: 200 },
    ],
    steps: 10,
  },
  // Линия почти вдоль столбца гексов, наступление начато: сплошная кривая и стрелки.
  {
    name: 'offensive-active',
    pts: [
      { x: 760, y: 230 },
      { x: 760, y: 620 },
    ],
    steps: 20,
    start: true,
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEW });
for (const scene of SCENES) {
  await open(page);
  await stroke(page, scene.pts, scene.steps);
  await page.waitForTimeout(300);
  if (scene.start) {
    await page
      .getByRole('button', { name: /Начать/ })
      .first()
      .click();
    await page.waitForTimeout(300);
  }
  await page.mouse.move(1300, 800);
  await page.screenshot({ path: path(`${scene.name}-1440x900`) });
}
// Пары «до | после» рядом: вырез вокруг линии из обоих снимков сцены.
const CROP = { x: 330, y: 150, width: 640, height: 500 };
const png = (file: string): string =>
  `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const cell = (file: string, label: string): string =>
  `<figure><div class="crop"><img src="${png(file)}"></div><figcaption>${label}</figcaption></figure>`;
for (const scene of SCENES) {
  const name = `${scene.name}-1440x900`;
  const before = new URL(`${name}-before.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');
  const after = new URL(`${name}-after.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');
  if (!existsSync(before) || !existsSync(after)) continue;
  const side = await browser.newPage({
    viewport: { width: CROP.width * 2 + 24, height: CROP.height + 40 },
  });
  await side.setContent(`<style>
    body { margin: 0; display: flex; gap: 24px; background: #fff; font: 16px sans-serif; }
    figure { margin: 0; }
    .crop { width: ${CROP.width}px; height: ${CROP.height}px; overflow: hidden; position: relative; }
    .crop img { position: absolute; left: ${-CROP.x}px; top: ${-CROP.y}px; }
    figcaption { height: 40px; line-height: 40px; text-align: center; }
  </style>${cell(before, 'до')}${cell(after, 'после')}`);
  await side.screenshot({
    path: new URL(`${name}-compare.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1'),
  });
  await side.close();
}
await browser.close();
