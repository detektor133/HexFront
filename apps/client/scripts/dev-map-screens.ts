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

// Выбор палитры местности: 3 палитры × территории вкл/выкл × телефон/ПК, плюс прозрачность.
const PALETTES = ['A', 'B', 'C'] as const;
const VIEWS = [
  { tag: '390x844', width: 390, height: 844, query: '&scale=1' },
  { tag: '1440x900-fit', width: 1440, height: 900, query: '' },
  { tag: '1440x900-zoom', width: 1440, height: 900, query: '&scale=1.6' },
] as const;

const SHOTS: readonly Shot[] = [
  ...PALETTES.flatMap((p) =>
    VIEWS.flatMap((v) =>
      [false, true].map((terr) => ({
        name: `terrain/${p}-${terr ? 'territories' : 'plain'}-${v.tag}`,
        width: v.width,
        height: v.height,
        query: `&panel=0&palette=${p}${terr ? '&territories=1' : ''}${v.query}`,
      })),
    ),
  ),
  ...PALETTES.flatMap((p) =>
    [65, 50].map((alpha) => ({
      name: `terrain/${p}-territories-alpha${alpha}-1440x900-zoom`,
      width: 1440,
      height: 900,
      query: `&panel=0&palette=${p}&territories=1&alpha=${alpha}&scale=1.6`,
    })),
  ),
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
