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
const SETTLE_MS = 2500;
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
}

// /dev/map — фиксированная карта-сцена; сид и карта заданы страницей, ввода в сцене нет.
const SCENES: readonly Scene[] = [
  {
    name: 'map-1440x900',
    url: '/dev/map?map=small&territories=1&scale=1',
    width: 1440,
    height: 900,
  },
  {
    name: 'map-390x844',
    url: '/dev/map?map=small&territories=1&panel=0&scale=1',
    width: 390,
    height: 844,
  },
];

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
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.evaluate(() => document.fonts.ready);
  // Сцена Pixi дорисовывается асинхронно после появления интерфейса.
  await page.waitForTimeout(SETTLE_MS);
  return page.screenshot();
}

interface Diff {
  readonly percent: number;
  readonly png: string | null;
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
      if (x.width !== y.width || x.height !== y.height) return { percent: 100, png: null };
      const out = new ImageData(x.width, x.height);
      let bad = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const diff = [0, 1, 2].some(
          (k) => Math.abs((x.data[i + k] ?? 0) - (y.data[i + k] ?? 0)) > tol,
        );
        if (diff) bad += 1;
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
      };
    },
    { a: expected.toString('base64'), b: actual.toString('base64'), tol: CHANNEL_TOLERANCE },
  );
}

mkdirSync(toPath(BASELINE), { recursive: true });
mkdirSync(toPath(DIFF), { recursive: true });
const server = startServer();
let failed = 0;
try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const scene of SCENES) {
    const actual = await shoot(page, scene);
    const baseline = toPath(new URL(`${scene.name}.png`, BASELINE));
    if (update || !existsSync(baseline)) {
      writeFileSync(baseline, actual);
      console.log(`${scene.name}: эталон ${update ? 'обновлён' : 'создан'} — ${baseline}`);
      continue;
    }
    const diff = await compare(page, readFileSync(baseline), actual);
    const ok = diff.percent <= THRESHOLD_PERCENT;
    const shown = diff.percent.toFixed(3).replace('.', ',');
    if (ok) {
      console.log(`${scene.name}: прошло, расхождение ${shown} %`);
      continue;
    }
    failed += 1;
    const diffPath = toPath(new URL(`${scene.name}-diff.png`, DIFF));
    if (diff.png !== null) writeFileSync(diffPath, Buffer.from(diff.png, 'base64'));
    writeFileSync(toPath(new URL(`${scene.name}-actual.png`, DIFF)), actual);
    const where =
      diff.png !== null
        ? `diff: ${diffPath}`
        : `размеры кадров разные, кадр: ${diffPath.replace('-diff', '-actual')}`;
    console.log(`${scene.name}: не прошло, расхождение ${shown} %, ${where}`);
  }
  await browser.close();
} finally {
  stopServer(server);
}
process.exit(failed > 0 ? 1 : 0);
