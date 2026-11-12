import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const CLIENT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));
const VITE_PATH = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const PREVIEW_URL = 'http://127.0.0.1:4173';

async function waitForPreview(preview: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) throw new Error('vite preview завершился до запуска');

    try {
      const response = await fetch(PREVIEW_URL);
      if (response.ok) return;
    } catch {
      // Сервер ещё не начал слушать порт.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error('vite preview не запустился за 30 секунд');
}

export async function runMemoryProbe(): Promise<void> {
  if (!existsSync(DIST_PATH)) throw new Error('сначала pnpm build');

  const preview = spawn(
    process.execPath,
    [VITE_PATH, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    { cwd: CLIENT_ROOT, stdio: 'ignore' },
  );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    await waitForPreview(preview);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:4173/match?debug=1&speed=5&map=gen&seed=42&players=30');
    await page.waitForSelector('canvas');
    // Секунд реального времени: по умолчанию 120 (10 минут матча на скорости 5); PROBE_WAIT_S=1440 даёт 2 часа матча.
    const waitSeconds = Number(process.env.PROBE_WAIT_S ?? 120);
    await page.waitForTimeout(waitSeconds * 1000);
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
    const lastMinute = Math.floor(Math.max(...samples.map((sample) => sample.matchSeconds)) / 60);
    const step = lastMinute > 20 ? 10 : 1;
    for (let minute = 0; minute <= lastMinute; minute += step) {
      const windowSamples = samples.filter(
        (sample) =>
          sample.matchSeconds >= minute * 60 && sample.matchSeconds < (minute + step) * 60,
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
    await browser?.close();
    preview.kill();
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await runMemoryProbe();
}
