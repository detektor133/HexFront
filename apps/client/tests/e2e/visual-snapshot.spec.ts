// Снимки HUD для визуального гейта агентного цикла (`tools/agent-loop/src/visual.ts`): не замена
// `@layout` геометрии, а то, что рект-ассерты не видят — искажённые/сжатые трансформацией элементы.
// Снимает только при `VISUAL_OUT_DIR`: вне гейта тесты пропускаются, файлов не остаётся.
import { expect, test } from '@playwright/test';

const WIDTHS = [360, 1024, 1920] as const;

for (const width of WIDTHS) {
  test(`@visual HUD ${width} px: снимок для визуальной проверки`, async ({ page }) => {
    const outDir = process.env.VISUAL_OUT_DIR;
    test.skip(
      outDir === undefined || outDir === '',
      'VISUAL_OUT_DIR не задан вне визуального гейта',
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/match?map=small');
    await expect(page.getByRole('banner')).toBeVisible();
    await page.screenshot({ path: `${outDir}/hud-${width}.png` });
  });
}
