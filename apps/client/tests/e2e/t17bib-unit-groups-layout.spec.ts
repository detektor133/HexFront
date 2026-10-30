import { expect, test } from '@playwright/test';

const viewports = [
  { width: 360, height: 640 },
  { width: 1024, height: 768 },
  { width: 1920, height: 1080 },
];

for (const viewport of viewports) {
  test(`@layout 07/T17bib: окно выбранных отрядов над нижней панелью при ${viewport.width} px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/match?map=small&seed=42&unitCard=groups');

    const card = page.getByRole('region', { name: 'Selected units' });
    await expect(card).toBeVisible();
    await expect(card.locator('ul button')).toHaveCount(2);
    const panel = page.locator('div[class*="dock"]');
    await expect(panel).toBeVisible();

    const [cardBounds, panelBounds] = await Promise.all([card.boundingBox(), panel.boundingBox()]);
    expect(cardBounds).not.toBeNull();
    expect(panelBounds).not.toBeNull();
    if (!cardBounds || !panelBounds) throw new Error('окно или нижняя панель не имеют границ');
    expect(cardBounds.y + cardBounds.height).toBeLessThanOrEqual(panelBounds.y);
    expect(cardBounds.x).toBeGreaterThanOrEqual(0);
    expect(cardBounds.x + cardBounds.width).toBeLessThanOrEqual(viewport.width);
  });
}
