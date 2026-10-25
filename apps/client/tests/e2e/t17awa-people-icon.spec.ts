import { expect, test } from '@playwright/test';

const WIDTHS = [1280, 1366, 1440, 1920] as const;

for (const width of WIDTHS) {
  test(`@layout иконка людей ${width} px: видима, не обрезана и не пересекается`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/match?map=small');

    const icon = page.getByRole('banner').getByLabel(/^(?:Люди|People)$/u);
    await expect(icon).toBeVisible();
    const result = await icon.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const parent = element.parentElement?.getBoundingClientRect();
      const next = element.nextElementSibling?.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        clippedByParent: Boolean(
          parent &&
          (rect.left < parent.left ||
            rect.right > parent.right ||
            rect.top < parent.top ||
            rect.bottom > parent.bottom),
        ),
        intersectsNext: Boolean(
          next &&
          rect.left < next.right &&
          rect.right > next.left &&
          rect.top < next.bottom &&
          rect.bottom > next.top,
        ),
      };
    });

    expect(result.width).toBe(14);
    expect(result.height).toBe(14);
    expect(result.clippedByParent).toBe(false);
    expect(result.intersectsNext).toBe(false);
  });
}
