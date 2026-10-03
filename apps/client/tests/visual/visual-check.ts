// Визуальная проверка без просмотра картинок (testing.md, «Визуальные тесты»): кадры страниц
// /dev/map сравниваются с эталонами в baseline/, в консоль — одна строка на кадр:
// «прошло / не прошло, расхождение X %, путь к diff». Порог — 0,1 % пикселей (testing.md).
// Запуск: pnpm visual            — сравнить с эталонами;
//         pnpm visual --update   — осознанно перезаписать эталоны (новые PNG приложить к отчёту).
// Детерминизм: карта и сид фиксированы страницей, анимации и переходы отключены, шрифты дожидаются.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from '@playwright/test';

const PORT = 5199;
const THRESHOLD_PERCENT = 0.1;
/** Допуск на канал: сглаживание шрифтов расходится на единицы, настоящая правка — на десятки. */
const CHANNEL_TOLERANCE = 16;
const SETTLE_MS = 1000;
const FREEZE_CSS =
  '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

const BASELINE = new URL('./baseline/', import.meta.url);
const DIFF = new URL('../../test-results/visual/', import.meta.url);
const toPath = (url: URL): string => fileURLToPath(url);

interface Scene {
  readonly name: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
}

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '844x390', width: 844, height: 390 },
  { name: '1440x900', width: 1440, height: 900 },
] as const;

const PAGES = [
  { name: 'units', url: '/dev/units' },
  { name: 'map', url: '/dev/map?map=small&territories=1&scale=1' },
  { name: 'ui', url: '/dev/ui?map=small&select=0&scale=1&freezeTime=1' },
  { name: 'match', url: '/dev/sandbox?map=small&select=0&speed=1&freezeTime=1' },
] as const;

const SCENES: readonly Scene[] = VIEWPORTS.flatMap((viewport) =>
  PAGES.flatMap((page) =>
    [1, 3].map((deviceScaleFactor) => ({
      name: `${page.name}-${viewport.name}-dpr${deviceScaleFactor}`,
      url: page.url,
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor,
    })),
  ),
);

const update = process.argv.includes('--update');

function startServer(): ChildProcess {
  return spawn(
    'pnpm',
    ['--filter', '@hexfront/client', 'exec', 'vite', '--port', String(PORT), '--strictPort'],
    {
      shell: true,
      stdio: 'ignore',
    },
  );
}

function stopServer(server: ChildProcess): void {
  if (server.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill();
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return;
    } catch {
      // сервер ещё стартует
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('dev-сервер не поднялся за 60 с');
}

async function shoot(page: Page, scene: Scene): Promise<Buffer> {
  await page.setViewportSize({ width: scene.width, height: scene.height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://localhost:${PORT}${scene.url}`);
  if (scene.url.includes('/dev/ui') || scene.url.includes('/dev/sandbox')) {
    await page.locator('header').waitFor({ state: 'visible' });
  }
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.evaluate(() => document.fonts.ready);
  // Сцена Pixi дорисовывается асинхронно после появления интерфейса.
  await page.waitForTimeout(SETTLE_MS);
  return page.screenshot();
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Diff {
  readonly percent: number;
  readonly png: string | null;
  /** Прямоугольник, охватывающий все расходящиеся пиксели; null — расхождений нет или размеры разные. */
  readonly box: Box | null;
}

/** Сравнение в браузере через canvas: декодер PNG не нужен, новых зависимостей нет. */
async function compare(page: Page, expected: Buffer, actual: Buffer): Promise<Diff> {
  return page.evaluate(
    async ({ a, b, tol }) => {
      const load = async (b64: string): Promise<ImageData> => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('canvas 2d недоступен');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height);
      };
      const x = await load(a);
      const y = await load(b);
      if (x.width !== y.width || x.height !== y.height)
        return { percent: 100, png: null, box: null };
      const out = new ImageData(x.width, x.height);
      let bad = 0;
      let minX = x.width;
      let minY = x.height;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0; i < x.data.length; i += 4) {
        const diff = [0, 1, 2].some(
          (k) => Math.abs((x.data[i + k] ?? 0) - (y.data[i + k] ?? 0)) > tol,
        );
        if (diff) {
          bad += 1;
          const px = (i / 4) % x.width;
          const py = Math.floor(i / 4 / x.width);
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
        out.data[i] = 255;
        out.data[i + 1] = diff ? 0 : Math.round((y.data[i + 1] ?? 0) * 0.3 + 178);
        out.data[i + 2] = diff ? 0 : Math.round((y.data[i + 2] ?? 0) * 0.3 + 178);
        out.data[i + 3] = 255;
      }
      const c = document.createElement('canvas');
      c.width = x.width;
      c.height = x.height;
      c.getContext('2d')?.putImageData(out, 0, 0);
      return {
        percent: (bad / (x.width * x.height)) * 100,
        png: c.toDataURL('image/png').split(',')[1] ?? null,
        box:
          maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      };
    },
    { a: expected.toString('base64'), b: actual.toString('base64'), tol: CHANNEL_TOLERANCE },
  );
}

/**
 * Самые глубокие элементы DOM, чей прямоугольник пересекает область расхождения: по ним агент
 * находит код без просмотра картинки. Холст Pixi — один элемент, внутри него DOM нет.
 */
async function intersectingSelectors(page: Page, box: Box): Promise<string[]> {
  return page.evaluate((b) => {
    const label = (el: Element): string => {
      const id = el.id ? `#${el.id}` : '';
      const testId = el.getAttribute('data-testid');
      const cls = [...el.classList]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join('');
      return `${el.tagName.toLowerCase()}${id}${cls}${testId ? `[data-testid=${testId}]` : ''}`;
    };
    const path = (el: Element): string => {
      const parts: string[] = [];
      for (let e: Element | null = el; e && e !== document.body && parts.length < 3;) {
        parts.unshift(label(e));
        e = e.parentElement;
      }
      return parts.join(' > ');
    };
    const hits = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.left < b.x + b.width &&
        r.right > b.x &&
        r.top < b.y + b.height &&
        r.bottom > b.y
      );
    };
    const all = [...document.body.querySelectorAll('*')].filter(
      (el) => !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName) && hits(el),
    );
    const deepest = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
    return deepest.slice(0, 8).map(path);
  }, box);
}

mkdirSync(toPath(BASELINE), { recursive: true });
mkdirSync(toPath(DIFF), { recursive: true });

async function checkScene(page: Page, scene: Scene, actual: Buffer): Promise<number> {
  const baseline = toPath(new URL(`${scene.name}.png`, BASELINE));
  if (update || !existsSync(baseline)) {
    writeFileSync(baseline, actual);
    console.log(`${scene.name}: эталон ${update ? 'обновлён' : 'создан'} — ${baseline}`);
    return 0;
  }
  const diff = await compare(page, readFileSync(baseline), actual);
  const ok = diff.percent <= THRESHOLD_PERCENT;
  const shown = diff.percent.toFixed(3).replace('.', ',');
  if (ok) {
    console.log(`${scene.name}: прошло, расхождение ${shown} %`);
    return 0;
  }
  const diffPath = toPath(new URL(`${scene.name}-diff.png`, DIFF));
  if (diff.png !== null) writeFileSync(diffPath, Buffer.from(diff.png, 'base64'));
  writeFileSync(toPath(new URL(`${scene.name}-actual.png`, DIFF)), actual);
  const where =
    diff.png !== null
      ? `diff: ${diffPath}`
      : `размеры кадров разные, кадр: ${diffPath.replace('-diff', '-actual')}`;
  console.log(`${scene.name}: не прошло, расхождение ${shown} %, ${where}`);
  if (diff.box !== null) {
    const { x, y, width, height } = diff.box;
    console.log(`  область: x=${x} y=${y} ширина=${width} высота=${height}`);
    const selectors = await intersectingSelectors(page, diff.box);
    for (const sel of selectors) console.log(`  элемент: ${sel}`);
  }
  return 1;
}

const server = startServer();
let failed = 0;
try {
  await waitForServer();
  const browser = await chromium.launch();
  const contexts = new Map<number, Awaited<ReturnType<typeof browser.newContext>>>();
  for (const scene of SCENES) {
    let context = contexts.get(scene.deviceScaleFactor);
    if (!context) {
      context = await browser.newContext({ deviceScaleFactor: scene.deviceScaleFactor });
      contexts.set(scene.deviceScaleFactor, context);
    }
    const page = await context.newPage();
    const actual = await shoot(page, scene);
    failed += await checkScene(page, scene, actual);
    await page.close();
  }
  for (const context of contexts.values()) await context.close();
  await browser.close();
} finally {
  stopServer(server);
}
process.exit(failed > 0 ? 1 : 0);
