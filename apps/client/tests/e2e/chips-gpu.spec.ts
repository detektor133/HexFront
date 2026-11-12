// Фишки отрядов рисует шейдер: его сборка и вызов отрисовки не должны давать ошибок WebGL.
// Вид фишек (пиксели) проверяет человек по снимкам visual-*.
import { expect, test, type Page } from '@playwright/test';

test('@layout фишки на GPU: шейдер собирается и рисует без ошибок WebGL', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (/aUV|GL Driver Message|Performance/u.test(text)) return;
    if (/shader|compile|link|GL_|WebGL|INVALID_/iu.test(text)) problems.push(text);
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/dev/sandbox?map=small&seed=42&players=4');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(3000);
  const glError = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2');
    return gl ? gl.getError() : -1;
  });
  expect(problems).toEqual([]);
  expect(glError).toBe(0);
});

test('@layout фишки на GPU: режим ?chips=legacy остаётся рабочим', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dev/sandbox?map=small&seed=42&players=4&chips=legacy');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

const COLORS = {
  own: [0x2e, 0x7d, 0x32],
  org: [0x2e, 0x7d, 0x4f],
  ink: [0x22, 0x21, 0x1e],
} as const;

/** Считает пиксели снимка, близкие к заданным цветам фишки (допуск ±8 на канал). */
async function chipPixels(page: Page): Promise<Record<string, number>> {
  const shot = await page.locator('canvas').first().screenshot();
  // Разбор снимка идёт в пустой вкладке: главный поток страницы игры занят отрисовкой WebGL
  // (в CI — программной) и не отвечал на evaluate дольше таймаута теста.
  const scratch = await page.context().newPage();
  try {
    return await decodeChipPixels(scratch, shot);
  } finally {
    await scratch.close();
  }
}

async function decodeChipPixels(page: Page, shot: Buffer): Promise<Record<string, number>> {
  return page.evaluate(
    async ({ b64, colors }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${b64}`)).blob(),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return {};
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const out: Record<string, number> = {};
      for (const [name, rgb] of Object.entries(colors)) {
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (
            Math.abs((data[i] ?? 0) - rgb[0]) <= 8 &&
            Math.abs((data[i + 1] ?? 0) - rgb[1]) <= 8 &&
            Math.abs((data[i + 2] ?? 0) - rgb[2]) <= 8
          ) {
            n += 1;
          }
        }
        out[name] = n;
      }
      return out;
    },
    { b64: shot.toString('base64'), colors: COLORS as unknown as Record<string, number[]> },
  );
}

test('@layout фишки на GPU: цвета фишек на экране близки к рисованию на процессоре', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const counts: Record<string, Record<string, number>> = {};
  for (const mode of ['gpu', 'legacy']) {
    await page.goto(
      `/dev/sandbox?map=small&seed=42&players=4&scale=1.5${mode === 'legacy' ? '&chips=legacy' : ''}`,
    );
    await expect(page.locator('canvas')).toBeVisible();
    await page.waitForTimeout(2500);
    counts[mode] = await chipPixels(page);
  }
  const gpu = counts.gpu ?? {};
  const legacy = counts.legacy ?? {};
  for (const name of Object.keys(COLORS)) {
    const a = gpu[name] ?? 0;
    const b = legacy[name] ?? 0;
    expect(b, `${name}: в режиме процессора пикселей нет`).toBeGreaterThan(0);
    expect(a, `${name}: GPU ${a}, процессор ${b}`).toBeGreaterThan(b * 0.6);
    expect(a, `${name}: GPU ${a}, процессор ${b}`).toBeLessThan(b * 1.6);
  }
});
