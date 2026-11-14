// Замер кадра камеры в большой войне: песочница 30 игроков на скорости 20×, затем зум колесом и панорама мышью.
// Запуск при работающем dev-сервере: node --experimental-strip-types apps/client/scripts/zoom-probe.ts [секунды_разгона]
import { chromium } from '@playwright/test';

const warm = Number(process.argv[2] ?? 60);
const browser = await chromium.launch({
  args: process.argv.includes('--gpu')
    ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    : [],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
let lastLine: {
  game: unknown;
  pixi: {
    graphicsDetails: {
      label: string;
      vertices: number;
      instructions: number;
      rebuildsPerSecond: number;
    }[];
  };
} | null = null;
page.on('request', (r) => {
  if (r.url().endsWith('/__telemetry')) lastLine = JSON.parse(r.postData() ?? 'null');
});
const showLine = (phase: string): void => {
  console.log(`>>> telemetry after ${phase}`, JSON.stringify(lastLine?.game));
  for (const d of lastLine?.pixi.graphicsDetails.filter(
    (x) => x.vertices > 500 || x.rebuildsPerSecond > 5,
  ) ?? [])
    console.log('   ', d.label || '(unnamed)', JSON.stringify(d));
};
await page.goto(
  'http://localhost:5173/dev/sandbox?map=gen&seed=43&players=30&speed=20&auto=1&watch=1',
);
await page.waitForSelector('canvas');
await page.waitForTimeout(warm * 1000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const busy = async () => {
  const m = (await cdp.send('Performance.getMetrics')).metrics;
  const g = (n: string) => m.find((x) => x.name === n)?.value ?? 0;
  return { task: g('TaskDuration'), script: g('ScriptDuration'), t: g('Timestamp') };
};
const frames = async (ms: number, act: (n: number) => Promise<void> | void) => {
  await page.evaluate(() => {
    const w = window as unknown as { __f: number[]; __run: boolean };
    w.__f = [];
    w.__run = true;
    let last = performance.now();
    const f = (t: number) => {
      w.__f.push(t - last);
      last = t;
      if (w.__run) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const b0 = await busy();
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < ms) await act(n++);
  const b1 = await busy();
  const load = {
    mainBusyPct: +((100 * (b1.task - b0.task)) / (b1.t - b0.t)).toFixed(0),
    scriptPct: +((100 * (b1.script - b0.script)) / (b1.t - b0.t)).toFixed(0),
  };
  return page.evaluate((load) => {
    const w = window as unknown as { __f: number[]; __run: boolean };
    w.__run = false;
    const s = w.__f.slice().sort((a, b) => a - b);
    const q = (p: number) => +(s[Math.floor(s.length * p)] ?? 0).toFixed(1);
    return { frames: s.length, p50: q(0.5), p95: q(0.95), max: q(0.999), ...load };
  }, load);
};
const box = { x: 720, y: 450 };
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
const idle = await frames(4000, () => page.waitForTimeout(16));
await report('idle');
await page.mouse.move(box.x, box.y);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
const zoom = await frames(5000, async (n) => {
  await page.mouse.wheel(0, Math.floor(n / 20) % 2 ? 40 : -40);
  await page.waitForTimeout(8);
});
showLine('zoom');
await report('zoom');
await page.mouse.move(box.x, box.y);
async function report(phase: string): Promise<void> {
  const { profile } = await cdp.send('Profiler.stop');
  console.log(`=== ${phase} ===`);
  const self = new Map<string, number>();
  const dt = profile.timeDeltas ?? [];
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples?.forEach((id, i) => {
    const f = byId.get(id)?.callFrame;
    if (!f) return;
    const k = `${f.functionName} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber}`;
    self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0));
  });
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const incl = new Map<string, number>();
  profile.samples?.forEach((id, i) => {
    const seen = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
      const f = byId.get(cur)?.callFrame;
      if (!f || !f.functionName) continue;
      const k = `${f.functionName} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber}`;
      if (seen.has(k)) continue;
      seen.add(k);
      incl.set(k, (incl.get(k) ?? 0) + (dt[i] ?? 0));
    }
  });
  console.log('--- inclusive ---');
  for (const [k, v] of [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30))
    console.log((v / 1000).toFixed(0).padStart(6), 'ms', k);
  console.log('--- self ---');
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(
      (v / 1000).toFixed(0).padStart(6),
      'ms',
      ((100 * v) / total).toFixed(1).padStart(5) + '%',
      k,
    );
}
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await cdp.send('Profiler.start');
const pan = await frames(5000, async (n) => {
  await page.mouse.move(box.x + Math.sin(n / 10) * 300, box.y + Math.cos(n / 10) * 200);
});
await report('pan');
await page.mouse.up();
console.log(JSON.stringify({ idle, zoom, pan }));
await browser.close();
