// Скриншоты /dev/map для отчёта этапа (не входит в CI: эталонные скриншот-тесты — с этапа 04).
// Запуск при работающем `pnpm --filter @hexfront/client dev`:
//   node --experimental-strip-types apps/client/scripts/dev-map-screens.ts
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173/dev/map?map=small';
const OUT = new URL('../../../docs/reports/stage-01/', import.meta.url);

interface Shot {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly query: string;
}

const SHOTS: readonly Shot[] = [
  { name: 'dev-map-390x844-fit', width: 390, height: 844, query: '' },
  { name: 'dev-map-390x844-scale1', width: 390, height: 844, query: '&scale=1' },
  { name: 'dev-map-390x844-scale2', width: 390, height: 844, query: '&scale=2' },
  { name: 'dev-map-1440x900-fit', width: 1440, height: 900, query: '' },
  { name: 'dev-map-1440x900-scale1', width: 1440, height: 900, query: '&scale=1' },
  { name: 'dev-map-1440x900-scale2', width: 1440, height: 900, query: '&scale=2' },
  ...[16, 28, 36].map((r) => ({
    name: `dev-map-1440x900-radius${r}`,
    width: 1440,
    height: 900,
    query: `&radius=${r}&scale=1`,
  })),
];

const browser = await chromium.launch();
for (const shot of SHOTS) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
  await page.goto(BASE + shot.query);
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail]')?.textContent !== '—',
  );
  await page.evaluate(() => document.fonts.ready);
  const detail = await page.textContent('[data-testid=detail]');
  const scale = await page.textContent('[data-testid=scale]');
  await page.screenshot({
    path: new URL(`${shot.name}.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1'),
  });
  console.log(`${shot.name}: scale ${scale}, ${detail}`);
  await page.close();
}
await browser.close();
