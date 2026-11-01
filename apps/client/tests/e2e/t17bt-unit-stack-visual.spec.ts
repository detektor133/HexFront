import { expect, test } from '@playwright/test';

test('@layout @visual 07/T17bt: снимок смешанной стопки фишек для визуального гейта', async ({
  page,
}) => {
  const outDir = process.env.VISUAL_OUT_DIR;
  test.skip(outDir === undefined || outDir === '', 'VISUAL_OUT_DIR не задан вне визуального гейта');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/dev/units?unitStack=three');
  const canvas = page.getByTestId('units-stage').locator('canvas');
  await expect(canvas).toBeVisible();
  await canvas.screenshot({ path: `${outDir}/unit-stack.png` });
});
