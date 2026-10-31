import { expect, test } from '@playwright/test';

const WIDTHS = [360, 1024, 1920] as const;

for (const width of WIDTHS) {
  test(`@layout 07/T17bmce: причина fort не перекрывает кнопку и соседние действия при ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dev/sandbox?map=small&seed=42&select=724&initialGold=0&freezeTime=1');

    const card = page.locator('section[aria-label]').filter({
      has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
    });
    await expect(card).toBeVisible();
    const fort = card.getByRole('button', { name: /fort|укрепление/i });
    await expect(fort).toBeVisible();
    await expect(fort).toBeDisabled();
    const reason = fort.locator('xpath=..').locator('[class*="reason_"]');
    await expect(reason).toHaveCount(1);
    await expect(reason).toBeVisible();
    await expect(reason).toContainText(/gold|золота/i);

    const bounds = await reason.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const action = element.parentElement;
      const siblings = Array.from(action?.parentElement?.children ?? [])
        .filter((sibling) => sibling !== action)
        .map((sibling) => {
          const siblingRect = sibling.getBoundingClientRect();
          return {
            left: siblingRect.left,
            right: siblingRect.right,
            top: siblingRect.top,
            bottom: siblingRect.bottom,
          };
        });
      return {
        reason: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        siblings,
      };
    });
    const buttonBounds = await fort.boundingBox();
    expect(buttonBounds).not.toBeNull();
    if (!buttonBounds) throw new Error('Кнопка fort не имеет границ');
    expect(bounds.reason.bottom).toBeGreaterThan(bounds.reason.top);
    expect(bounds.reason.top).toBeGreaterThanOrEqual(buttonBounds.y + buttonBounds.height);
    for (const sibling of bounds.siblings) {
      const intersects =
        bounds.reason.left < sibling.right &&
        bounds.reason.right > sibling.left &&
        bounds.reason.top < sibling.bottom &&
        bounds.reason.bottom > sibling.top;
      expect(intersects).toBe(false);
    }
  });
}
