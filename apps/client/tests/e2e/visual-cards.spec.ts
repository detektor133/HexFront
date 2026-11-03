// Снимки карточек клетки и города для визуального гейта агентного цикла: ревьюер оценивает глазами
// выравнивание и ритм строк, которые рект-ассерты не видят. Снимает только при `VISUAL_OUT_DIR`.
import { expect, test } from '@playwright/test';

const WIDTHS = [360, 1024, 1920] as const;
const CARDS = [
  { name: 'hex', select: 724 },
  { name: 'city', select: 765 },
] as const;

for (const width of WIDTHS) {
  for (const card of CARDS) {
    test(`@visual карточка ${card.name} ${width} px: снимок для визуальной проверки`, async ({
      page,
    }) => {
      const outDir = process.env.VISUAL_OUT_DIR;
      test.skip(
        outDir === undefined || outDir === '',
        'VISUAL_OUT_DIR не задан вне визуального гейта',
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/sandbox?map=small&seed=42&select=${card.select}`);
      const section = page.locator('section[aria-label]').filter({
        has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
      });
      await expect(section).toBeVisible();
      await section.screenshot({ path: `${outDir}/card-${card.name}-${width}.png` });
    });
  }
}
