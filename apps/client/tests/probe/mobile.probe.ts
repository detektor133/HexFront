// Зонд «слабый телефон»: реальный локальный матч в эмуляции телефона с замедлением CPU.
// Меряет кадры главного потока и длинные задачи для трёх форматов игры (лёгкий, средний, тяжёлый
// на большой карте Europe), при замедлении CPU ×4 и ×6, в обычной и ускоренной (имитация поздней
// игры) скорости. Параметры зашиты в файл, чтобы запуск был одной голой командой.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { test } from '@playwright/test';

const FORMATS: Record<string, string> = {
  light: 'map=small&seed=42&players=6',
  medium: 'map=gen&seed=43&players=30',
  heavy: 'map=europe&seed=7&players=30&difficulty=hard',
};
const THROTTLES = [1, 4, 6];
const SPEEDS = [1];
const SECONDS = 20;
// Какие форматы гонять сейчас: 'light', 'medium', 'heavy' (локальная игра) и 'online' — матч на 30
// игроков против настоящего сервера (запускается на время зонда), клиент без своей симуляции.
const FORMAT_LIST: string[] = ['light', 'medium', 'heavy', 'online'];
// Профиль процессора V8 сам даёт провалы кадров на сотни миллисекунд (проверено сравнением), поэтому
// кадры меряются без него; профиль включается отдельным прогоном для поиска горячих функций.
const PROFILE_CPU = false;
const SERVER_PORT = 18_090;
const SERVER_URL = `ws://127.0.0.1:${SERVER_PORT}`;

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

/** Самый длинный непрерывный отрезок работы (без простоя): что в нём заняло время. */
function printLongestRun(profile: CpuProfile, byId: Map<number, CpuNode>, label: string): void {
  let best = { total: 0, from: 0, to: 0 };
  let runStart = 0;
  let runTotal = 0;
  const close = (end: number): void => {
    if (runTotal > best.total) best = { total: runTotal, from: runStart, to: end };
    runTotal = 0;
  };
  profile.samples.forEach((id, i) => {
    const name = byId.get(id)?.callFrame.functionName ?? '';
    if (name === '(idle)') {
      close(i);
      runStart = i + 1;
      return;
    }
    runTotal += profile.timeDeltas[i] ?? 0;
  });
  close(profile.samples.length);
  const inside = new Map<string, number>();
  for (let i = best.from; i < best.to; i += 1) {
    const frame = byId.get(profile.samples[i] ?? -1)?.callFrame;
    if (!frame) continue;
    const key = `${frame.functionName || '(анонимная)'} ${frame.url.split('/').slice(-1)[0] || '(native)'}:${frame.lineNumber}`;
    inside.set(key, (inside.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
  const top = [...inside.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`LONGEST ${label}: ${(best.total / 1000).toFixed(0)} мс подряд`);
  for (const [key, us] of top)
    console.log(`LONGEST ${label}   ${(us / 1000).toFixed(0)} мс ${key}`);
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
  printLongestRun(profile, byId, label);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  for (const [key, us] of top)
    console.log(`TOP ${label} ${((us / total) * 100).toFixed(1)}% ${key}`);
}

let server: ChildProcess | null = null;

test.beforeAll(async () => {
  if (!FORMAT_LIST.includes('online')) return;
  const main = fileURLToPath(new URL('../../../server/src/main.ts', import.meta.url));
  server = spawn(process.execPath, ['--experimental-strip-types', main], {
    env: { ...process.env, PORT: String(SERVER_PORT), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${SERVER_PORT}/healthz`)).ok) return;
    } catch {
      // сервер ещё поднимается
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('сервер зонда не запустился');
});

test.afterAll(() => {
  server?.kill();
});

interface Probe {
  __stages: Record<string, number[]>;
  __frames: number[];
  __long: number[];
}

for (const format of FORMAT_LIST) {
  for (const throttle of THROTTLES) {
    for (const speed of SPEEDS) {
      test(`телефон ${format}: CPU x${throttle}, скорость ${speed}`, async ({ page, context }) => {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
        if (PROFILE_CPU) await cdp.send('Profiler.enable');
        page.on('pageerror', (e) => console.log('pageerror', e.message));
        await page.addInitScript(() => {
          const w = window as unknown as Probe;
          w.__stages = {};
          (
            globalThis as unknown as { __hexfrontProbe: (k: string, ms: number) => void }
          ).__hexfrontProbe = (kind, ms) => {
            (w.__stages[kind] ??= []).push(ms);
          };
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
        if (format === 'online') {
          // Лобби закрытой комнаты → «Начать сейчас»: 1 человек и 29 ботов, как в быстром матче.
          await page.goto(`/online?mode=private&server=${SERVER_URL}`);
          await page
            .getByRole('button', { name: /Начать сейчас|Start now/ })
            .click({ timeout: 30_000 });
        } else {
          await page.goto(`/match?${FORMATS[format]}&speed=${speed}`);
        }
        await page.waitForSelector('canvas', { timeout: 90_000 });
        await page.waitForTimeout(8000);
        await page.evaluate(() => {
          const w = window as unknown as Probe;
          w.__frames.length = 0;
          w.__long.length = 0;
          w.__stages = {};
        });
        if (PROFILE_CPU) await cdp.send('Profiler.start');
        await page.waitForTimeout(SECONDS * 1000);
        if (PROFILE_CPU) {
          const { profile } = (await cdp.send('Profiler.stop')) as unknown as {
            profile: CpuProfile;
          };
          printTop(profile, `${format} x${throttle}`);
        }
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
        const stages = await page.evaluate(() => {
          const w = window as unknown as Probe;
          return Object.entries(w.__stages).map(([kind, values]) => {
            const s = [...values].sort((a, b) => a - b);
            const at = (p: number): number =>
              s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
            return `${kind}: ${s.length} шт, p50 ${at(0.5).toFixed(1)}, p99 ${at(0.99).toFixed(1)}, макс ${(s.at(-1) ?? 0).toFixed(1)} мс`;
          });
        });
        for (const line of stages) console.log(`STAGE ${format} x${throttle} ${line}`);
      });
    }
  }
}
