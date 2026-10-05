// Ручной замер кадра песочницы: 10 минут матча на скорости 5×.
// Запуск при работающем dev-сервере: node --experimental-strip-types apps/client/scripts/sandbox-probe.ts
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/dev/sandbox?map=gen&seed=43&players=30&speed=5');
await page.waitForSelector('canvas');
const result = await page.evaluate(async () => {
  const samples: number[] = [];
  let last = performance.now();
  const started = last;
  let frames = 0;
  return await new Promise<{ readonly frames: number; readonly p95FrameMs: number }>((resolve) => {
    const measure = (now: number): void => {
      samples.push(now - last);
      last = now;
      frames += 1;
      if (now - started < 600_000) requestAnimationFrame(measure);
      else {
        const sorted = samples.slice().sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        resolve({ frames, p95FrameMs: +p95.toFixed(2) });
      }
    };
    requestAnimationFrame(measure);
  });
});
console.log(result);
await browser.close();
