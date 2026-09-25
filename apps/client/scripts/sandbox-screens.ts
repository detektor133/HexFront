// Скриншоты /dev/sandbox для отчёта этапа 03 (не входит в CI: скриншот-тесты — с этапа 04).
// Запуск при работающем dev-сервере (порт — аргументом, по умолчанию 5173):
//   node --experimental-strip-types apps/client/scripts/sandbox-screens.ts 5174
import { readFileSync } from 'node:fs';

import { chromium, type Page } from '@playwright/test';

import {
  createMatch,
  distance,
  hexFromId,
  loadMap,
  type MapStatic,
} from '../../../packages/sim/src/index.ts';

const PORT = process.argv[2] ?? '5173';
const OUT = new URL('../../../docs/reports/stage-03/', import.meta.url);
const SCALE = 2.5;
const SCENE_SETTLE_MS = 1500;

const json: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(json);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const map: MapStatic = loaded.map;
// Тот же старт, что у песочницы: сид 42, 2 игрока, человек — игрок 0.
const start = createMatch(map, [{ name: 'A' }, { name: 'B' }], 42);
const capital = start.cities.find((c) => c.id === start.players[0]?.capitalCityId);
if (!capital) throw new Error('нет столицы');
const home = hexFromId(capital.hex, map.width);
// Ближайший к столице нейтральный город — цель атаки.
const target = start.cities
  .filter((c) => c.owner < 0)
  .sort(
    (a, b) =>
      distance(hexFromId(a.hex, map.width), home) - distance(hexFromId(b.hex, map.width), home),
  )[0];
if (!target) throw new Error('нет нейтрального города');

const path = (name: string): string =>
  new URL(`${name}.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');

// Камера центрируется на выбранном гексе (у края карты — упирается в границу, поэтому для боя
// в центр ставится город-цель, а не столица у левого края).
async function open(page: Page, hex: number): Promise<void> {
  await page.goto(`http://localhost:${PORT}/dev/sandbox?map=small&select=${hex}&scale=${SCALE}`);
  await page.getByText('Армии').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Сцена Pixi дорисовывается асинхронно после появления интерфейса.
  await page.waitForTimeout(SCENE_SETTLE_MS);
}

const browser = await chromium.launch();
const W = 1440;
const H = 900;
const page = await browser.newPage({ viewport: { width: W, height: H } });
await open(page, capital.hex);
await page.screenshot({ path: path('sandbox-1440x900-city') });
await open(page, target.hex);
// Выбрать «1-ю армию» и прицелиться в нейтральный город — прогноз в карточке отряда.
await page.getByRole('button', { name: 'Выбрать' }).first().click();
await page.mouse.click(W / 2, H / 2);
await page.getByText('Атаковать').waitFor();
await page.screenshot({ path: path('sandbox-1440x900-forecast') });
// Атака: отряды идут к городу и вступают в бой — маркер боя на карте.
await page.getByText('Атаковать').click();
await page.waitForTimeout(25_000);
await page.screenshot({ path: path('sandbox-1440x900-battle') });
await page.close();

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await open(phone, capital.hex);
await phone.screenshot({ path: path('sandbox-390x844') });
await browser.close();
console.log(`цель: город ${target.name} (гекс ${target.hex}), столица ${capital.hex}`);
