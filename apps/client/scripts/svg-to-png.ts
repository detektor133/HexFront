// Растеризует все *.svg папки в PNG рядом (для графиков отчётов: владелец смотрит PNG).
// Запуск: node --experimental-strip-types apps/client/scripts/svg-to-png.ts <папка>... [--keep] [--scale=N]
// Без --keep исходные SVG удаляются.
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const keep = process.argv.includes('--keep');
const scaleOption = process.argv.find((a) => a.startsWith('--scale='));
const scale = Number(scaleOption?.slice('--scale='.length) ?? 2);
if (!Number.isFinite(scale) || scale <= 0)
  throw new Error('масштаб должен быть положительным числом');
const dirs = process.argv.slice(2).filter((a) => a !== '--keep');
const inputDirs = dirs.filter((a) => !a.startsWith('--scale='));
if (inputDirs.length === 0) throw new Error('нужна папка с SVG');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: scale });
let count = 0;
for (const dir of inputDirs) {
  for (const file of readdirSync(resolve(dir)).filter((f) => f.endsWith('.svg'))) {
    const path = join(resolve(dir), file);
    const svg = readFileSync(path, 'utf8');
    const size = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    const width = /<svg\b[^>]*\bwidth="(\d+)"/u.exec(svg);
    const height = /<svg\b[^>]*\bheight="(\d+)"/u.exec(svg);
    await page.setViewportSize({
      width: Number(width?.[1] ?? size?.[1] ?? 800),
      height: Number(height?.[1] ?? size?.[2] ?? 400),
    });
    await page.setContent(`<body style="margin:0;background:#fff">${svg}</body>`);
    writeFileSync(path.replace(/\.svg$/, '.png'), await page.screenshot());
    if (!keep) rmSync(path);
    count += 1;
  }
}
await browser.close();
console.log(`svg-to-png: ${count} файл(ов)`);
