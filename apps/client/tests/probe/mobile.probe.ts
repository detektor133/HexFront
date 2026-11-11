// Зонд «слабый телефон»: реальный локальный матч в эмуляции телефона с замедлением CPU.
// Меряет кадры главного потока и длинные задачи для трёх форматов игры (лёгкий, средний, тяжёлый
// на большой карте Europe), при замедлении CPU ×4 и ×6, в обычной и ускоренной (имитация поздней
// игры) скорости. Параметры зашиты в файл, чтобы запуск был одной голой командой.
import { test } from '@playwright/test';

const FORMATS: Record<string, string> = {
  light: 'map=small&seed=42&players=6',
  medium: 'map=gen&seed=43&players=30',
  heavy: 'map=europe&seed=7&players=30&difficulty=hard',
};
const THROTTLES = [1, 4, 6];
const SPEEDS = [1];
const SECONDS = 20;
const FORMAT_LIST = ['light', 'medium', 'heavy'];

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  launchOptions: {
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  },
});

interface CpuNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
}
interface CpuProfile {
  nodes: CpuNode[];
  samples: number[];
  timeDeltas: number[];
}

/** Печатает функции с наибольшим собственным временем главного потока. */
function printTop(profile: CpuProfile, label: string): void {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const frame = byId.get(id)?.callFrame;
    if (!frame) return;
    const name = frame.functionName || '(анонимная)';
    const file = frame.url.split('/').slice(-1)[0] || '(native)';
    const key = name === '(idle)' ? '(idle)' : `${name} ${file}:${frame.lineNumber}`;
    const dt = profile.timeDeltas[i] ?? 0;
    self.set(key, (self.get(key) ?? 0) + dt);
    total += dt;
  });
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  for (const [key, us] of top)
    console.log(`TOP ${label} ${((us / total) * 100).toFixed(1)}% ${key}`);
}

interface Probe {
  __frames: number[];
  __long: number[];
}

for (const format of FORMAT_LIST) {
  for (const throttle of THROTTLES) {
    for (const speed of SPEEDS) {
      test(`телефон ${format}: CPU x${throttle}, скорость ${speed}`, async ({ page, context }) => {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
        await cdp.send('Profiler.enable');
        page.on('pageerror', (e) => console.log('pageerror', e.message));
        await page.addInitScript(() => {
          const w = window as unknown as Probe;
          w.__frames = [];
          w.__long = [];
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) w.__long.push(e.duration);
          }).observe({ entryTypes: ['longtask'] });
          let last = performance.now();
          const tick = (t: number): void => {
            w.__frames.push(t - last);
            last = t;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await page.goto(`/match?${FORMATS[format]}&speed=${speed}`);
        await page.waitForSelector('canvas', { timeout: 90_000 });
        await page.waitForTimeout(8000);
        await page.evaluate(() => {
          const w = window as unknown as Probe;
          w.__frames.length = 0;
          w.__long.length = 0;
        });
        await cdp.send('Profiler.start');
        await page.waitForTimeout(SECONDS * 1000);
        const { profile } = (await cdp.send('Profiler.stop')) as unknown as { profile: CpuProfile };
        printTop(profile, `${format} x${throttle}`);
        const r = await page.evaluate(() => {
          const w = window as unknown as Probe;
          const f = [...w.__frames].sort((a, b) => a - b);
          const q = (p: number): number => f[Math.min(f.length - 1, Math.floor(f.length * p))] ?? 0;
          const total = f.reduce((s, x) => s + x, 0);
          return {
            frames: f.length,
            fps: +((f.length / total) * 1000).toFixed(1),
            p50: +q(0.5).toFixed(1),
            p95: +q(0.95).toFixed(1),
            p99: +q(0.99).toFixed(1),
            max: +(f[f.length - 1] ?? 0).toFixed(1),
            over50ms: f.filter((x) => x > 50).length,
            longTasks: w.__long.length,
            longTaskMs: +w.__long.reduce((s, x) => s + x, 0).toFixed(0),
          };
        });
        console.log(`PROBE ${format} CPU x${throttle} скорость ${speed}:`, JSON.stringify(r));
      });
    }
  }
}
