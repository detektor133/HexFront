// Зонд провалов кадров: трасса Chrome (DevTools timeline) за 20 секунд матча при замедлении CPU ×6.
// Находит самые долгие задачи главного потока и печатает, из каких событий они состоят
// (раскладка стилей, отрисовка, GC, вызовы JS, загрузка текстур).
import { test } from '@playwright/test';

// Включается вручную: трасса тяжёлая и удлиняет общий запуск зондов на минуту.
const ENABLED = false;
const FORMAT = 'map=gen&seed=43&players=30';
const THROTTLE = 6;
const SECONDS = 20;

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  launchOptions: {
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  },
});

interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  tid: number;
  pid: number;
  args?: Record<string, unknown>;
  cat?: string;
}

test(`провалы кадров: трасса, CPU x${THROTTLE}`, async ({ page, context }) => {
  test.skip(!ENABLED, 'включается вручную (ENABLED в файле)');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.goto(`/match?${FORMAT}`);
  await page.waitForSelector('canvas', { timeout: 90_000 });
  await page.waitForTimeout(8000);

  const events: TraceEvent[] = [];
  cdp.on('Tracing.dataCollected', (chunk: { value: TraceEvent[] }) => {
    events.push(...chunk.value);
  });
  const complete = new Promise<void>((resolve) =>
    cdp.once('Tracing.tracingComplete', () => resolve()),
  );
  await cdp.send('Tracing.start', {
    categories:
      'devtools.timeline,disabled-by-default-devtools.timeline,v8,blink,cc,gpu,disabled-by-default-v8.gc',
    transferMode: 'ReportEvents',
  });
  await page.waitForTimeout(SECONDS * 1000);
  await cdp.send('Tracing.end');
  await complete;

  // Главный поток рендерера — тот, где идёт RunTask с наибольшим числом событий.
  const byThread = new Map<string, number>();
  for (const e of events)
    byThread.set(`${e.pid}:${e.tid}`, (byThread.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
  const names = new Map<string, string>();
  for (const e of events) {
    if (e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, String(e.args?.name ?? ''));
  }
  const mainKey = [...byThread.entries()]
    .filter(([key]) => names.get(key) === 'CrRendererMain')
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  console.log(
    `HITCH потоки: ${[...names.entries()]
      .filter(([, n]) => /Main|Compositor|Raster|GPU/.test(n))
      .map(([k, n]) => `${n}(${k})`)
      .join(', ')}`,
  );
  if (!mainKey) {
    console.log('HITCH главный поток не найден');
    return;
  }
  const main = events
    .filter((e) => `${e.pid}:${e.tid}` === mainKey && e.ph === 'X' && e.dur !== undefined)
    .sort((a, b) => a.ts - b.ts);
  // Промежутки между началами кадров главного потока: самые длинные и что в них происходило.
  const frames = main.filter((e) => e.name === 'ProxyMain::BeginMainFrame').map((e) => e.ts);
  const gaps = frames
    .slice(1)
    .map((ts, index) => ({
      from: frames[index] as number,
      to: ts,
      gap: ts - (frames[index] as number),
    }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);
  console.log(
    `HITCH кадров ${frames.length}, самые длинные промежутки, мс: ${gaps.map((g) => (g.gap / 1000).toFixed(0)).join(', ')}`,
  );
  for (const gap of gaps.slice(0, 3)) {
    const overlapping = events.filter(
      (e) =>
        e.ph === 'X' &&
        e.dur !== undefined &&
        e.dur > 15_000 &&
        e.ts < gap.to &&
        e.ts + e.dur > gap.from,
    );
    const lines = overlapping
      .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
      .slice(0, 8)
      .map(
        (e) =>
          `${names.get(`${e.pid}:${e.tid}`) ?? e.tid}/${e.name} ${((e.dur ?? 0) / 1000).toFixed(0)}мс`,
      );
    console.log(`HITCH промежуток ${(gap.gap / 1000).toFixed(0)} мс: ${lines.join('; ')}`);
  }
});
