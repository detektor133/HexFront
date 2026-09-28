// Скриншоты и видео 04/T22 «Автокомандование» для отчёта этапа 04 (песочница, сид 42, 1440×900,
// вся карта small): значок «А» на карточке армии (вкл./выкл.), тулбар из 5 кнопок, меню настроек;
// затем 6,5 минуты игры в реальном времени — обе армии под commander, кадр раз в 30 с; когда у армии
// игрока появляется фронт, жмём ▶ — линию строит commander.
// Запуск при работающем dev-сервере:
//   node --experimental-strip-types apps/client/scripts/auto-command-screens.ts 5173
import { renameSync } from 'node:fs';

import { chromium, type Page } from '@playwright/test';

const PORT = process.argv[2] ?? '5173';
const OUT = new URL('../../../docs/reports/stage-04/', import.meta.url);
const file = (name: string): string => new URL(name, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');
const png = (name: string): string => file(`${name}.png`);

/** 6,5 минуты: границы соседей сходятся к 5-й минуте — ▶ и начало наступления попадают в запись. */
const MATCH_MS = 6.5 * 60 * 1000;
const FRAME_EVERY_MS = 30 * 1000;
const SCENE_SETTLE_MS = 2500;
const VIDEO = { width: 960, height: 600 };

async function clip(page: Page, selector: string, name: string, pad = 8): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`нет элемента ${selector}`);
  await page.screenshot({
    path: png(name),
    clip: {
      x: box.x - pad,
      y: box.y - pad,
      width: box.width + 2 * pad,
      height: box.height + 2 * pad,
    },
  });
}

const clock = (page: Page): Promise<string> =>
  page
    .locator('header')
    .innerText()
    .then((s) => s.replace(/\s+/g, ' '));

async function closeUps(page: Page): Promise<void> {
  await clip(page, '[class*="card"]', 'auto-card-on');
  await page.getByRole('button', { name: 'Автокомандование включено' }).click();
  await page.waitForTimeout(400);
  await clip(page, '[class*="card"]', 'auto-card-off');
  await page.getByRole('button', { name: 'Автокомандование выключено' }).click();
  await page.waitForTimeout(400);
  // Выбор армии карточкой открывает тулбар; auto не выключает.
  await page.locator('[class*="pick"]').first().click();
  await page.getByRole('toolbar').waitFor();
  await clip(page, '[class*="dock"]', 'auto-toolbar');
  await page.keyboard.press('Escape');
  await page.locator('[class*="pick"]').first().click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('dialog', { name: 'Настройки' }).waitFor();
  await page.screenshot({
    path: png('auto-settings'),
    clip: { x: 1100, y: 0, width: 340, height: 140 },
  });
  await page.getByRole('button', { name: 'Настройки' }).click();
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: file('video'), size: VIDEO },
});
const page = await context.newPage();
await page.goto(`http://localhost:${PORT}/dev/sandbox?map=small&scale=1`);
await page.getByText('1-я армия').first().waitFor();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(SCENE_SETTLE_MS);
await closeUps(page);

const start = Date.now();
let pressed = false;
let pressedAt = 0;
let lineShot = false;
let frame = 0;
while (Date.now() - start < MATCH_MS) {
  const t = Date.now() - start;
  if (t >= frame * FRAME_EVERY_MS) {
    const mmss = new Date(frame * FRAME_EVERY_MS).toISOString().slice(14, 19).replace(':', '');
    await page.screenshot({ path: png(`auto-match-${mmss}`) });
    console.log(mmss, await clock(page));
    frame += 1;
  }
  const run = page.getByRole('button', { name: 'Начать' }).first();
  if (!pressed && (await run.count()) > 0 && (await run.isEnabled())) {
    await run.click();
    pressed = true;
    console.log('▶ нажата', await clock(page));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: png('auto-start-pressed') });
    pressedAt = Date.now();
  }
  if (pressedAt > 0 && !lineShot && Date.now() - pressedAt > FRAME_EVERY_MS) {
    await page.screenshot({ path: png('auto-start-30s') });
    lineShot = true;
  }
  await page.waitForTimeout(1000);
}
await page.screenshot({ path: png('auto-match-end') });
console.log('end', await clock(page));
const video = page.video();
await context.close();
if (video) renameSync(await video.path(), file('auto-command.webm'));
await browser.close();
