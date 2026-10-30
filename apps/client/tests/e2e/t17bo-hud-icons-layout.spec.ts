import { expect, test } from '@playwright/test';

for (const width of [360, 1024, 1920] as const) {
  test(`@layout 07/T17bo: шесть иконок HUD имеют размер 14×14 и не переполняют ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/match?map=small');

    const hud = page.getByRole('banner');
    await expect(hud).toBeVisible();
    const icons = hud.locator('svg[aria-label]');
    const language = await page.locator('html').getAttribute('lang');
    const labels =
      language?.startsWith('ru') === true
        ? ['Люди', 'Золото', 'Налог', 'Снабжение', 'Время', 'Место']
        : ['People', 'Gold', 'Tax', 'Supply', 'Time', 'Place'];
    await expect(icons).toHaveCount(labels.length);
    for (const label of labels)
      await expect(hud.locator(`svg[aria-label="${label}"]`)).toBeVisible();

    const layout = await hud.evaluate((element) => {
      const hudRect = element.getBoundingClientRect();
      const metrics = Array.from(element.querySelectorAll<SVGElement>('svg[aria-label]')).map(
        (icon) => {
          const rect = icon.getBoundingClientRect();
          const parent = icon.parentElement;
          const parentRect = parent?.getBoundingClientRect();
          return {
            label: icon.getAttribute('aria-label'),
            width: rect.width,
            height: rect.height,
            withinHud: rect.left >= hudRect.left && rect.right <= hudRect.right,
            withinMetric:
              parentRect !== undefined &&
              rect.left >= parentRect.left &&
              rect.right <= parentRect.right,
            hasValue: Boolean(parent?.textContent?.trim()),
          };
        },
      );
      return {
        overflows: element.scrollWidth > element.clientWidth,
        metrics,
      };
    });

    expect(layout.overflows).toBe(false);
    expect(layout.metrics.map((metric) => metric.label)).toEqual(labels);
    for (const metric of layout.metrics) {
      expect(metric.width).toBe(14);
      expect(metric.height).toBe(14);
      expect(metric.withinHud).toBe(true);
      expect(metric.withinMetric).toBe(true);
      expect(metric.hasValue).toBe(true);
    }
  });
}
