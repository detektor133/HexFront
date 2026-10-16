import { readFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:4173/match?debug=1&speed=5&map=gen&seed=42&players=30');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(120_000);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать телеметрию' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error('Файл телеметрии не скачан');
  const lines = await readFile(path, 'utf8');
  const samples = lines
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map(
      (line) =>
        JSON.parse(line) as {
          matchSeconds: number;
          heap: { used: number | null };
          pixi: { canvasTextTextures: number | null };
        },
    );
  for (let minute = 0; minute <= 10; minute += 1) {
    const windowSamples = samples.filter(
      (sample) => sample.matchSeconds >= minute * 60 && sample.matchSeconds < (minute + 1) * 60,
    );
    const heaps = windowSamples
      .map((sample) => sample.heap.used)
      .filter((value): value is number => value !== null);
    const caches = windowSamples
      .map((sample) => sample.pixi.canvasTextTextures)
      .filter((value): value is number => value !== null);
    console.log(
      JSON.stringify({
        minute,
        heapMax: heaps.length > 0 ? Math.max(...heaps) : null,
        heapMin: heaps.length > 0 ? Math.min(...heaps) : null,
        textCacheKeys: caches.at(-1) ?? null,
      }),
    );
  }
} finally {
  await browser.close();
}
