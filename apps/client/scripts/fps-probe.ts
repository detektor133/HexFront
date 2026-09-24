// Замер fps на /dev/map (small, 1440×900, масштаб 1): 5 с в покое и 5 с непрерывного зума колесом.
// Запуск при работающем dev-сервере: node --experimental-strip-types apps/client/scripts/fps-probe.ts [--gpu]
// --gpu включает аппаратный WebGL (ANGLE/D3D11); без него headless Chromium рисует программно.
import { chromium } from '@playwright/test';
const args = process.argv.includes('--gpu')
  ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
  : [];
const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/dev/map?map=small&scale=1');
await page.waitForFunction(
  () => document.querySelector('[data-testid=detail]')?.textContent !== '—',
);
await page.waitForTimeout(1000);
const res = await page.evaluate(async () => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg && gl ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a';
  const measure = async (ms: number, during?: (n: number) => void) => {
    let n = 0;
    const t0 = performance.now();
    let worst = 0;
    let last = t0;
    await new Promise<void>((res) => {
      const f = (t: number) => {
        n++;
        worst = Math.max(worst, t - last);
        last = t;
        during?.(n);
        if (t - t0 < ms) requestAnimationFrame(f);
        else res();
      };
      requestAnimationFrame(f);
    });
    return {
      fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1),
      worstFrameMs: +worst.toFixed(1),
    };
  };
  const c = document.querySelector('canvas');
  if (!c) throw new Error('на странице нет canvas');
  const r = c.getBoundingClientRect();
  const idle = await measure(5000);
  const zoom = await measure(5000, (n) =>
    c.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: Math.floor(n / 40) % 2 ? 30 : -30,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  return { gpu, idle, zoom };
});
console.log(JSON.stringify(res));
await browser.close();
