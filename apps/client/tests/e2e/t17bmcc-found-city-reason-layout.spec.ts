import { expect, test } from '@playwright/test';

const WIDTHS = [360, 1024, 1920] as const;

for (const width of WIDTHS) {
  test(`@layout 07/T17bmcc: причина foundCity не перекрывает элементы карточки при ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dev/sandbox?map=small&seed=42&select=724');

    const card = page.locator('section[aria-label]').filter({
      has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
    });
    await expect(card).toBeVisible();

    const foundCity = card.getByRole('button', { name: /found city|основать город/i });
    await expect(foundCity).toBeVisible();

    const reasonId = await foundCity.evaluate((button) => {
      const reasonId = button.getAttribute('aria-describedby');
      const reason = reasonId ? document.getElementById(reasonId) : null;
      if (!reason) throw new Error('У foundCity отсутствует связанная причина недоступности');
      reason.textContent = 'Ближе 4 гексов к другому городу';
      return reasonId;
    });
    await expect(foundCity).toBeDisabled();
    const reason = card.locator(`[id="${reasonId}"]`);
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText('Ближе 4 гексов к другому городу');

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
    expect(bounds.reason.bottom).toBeGreaterThan(bounds.reason.top);
    const buttonBounds = await foundCity.boundingBox();
    expect(buttonBounds).not.toBeNull();
    if (!buttonBounds) throw new Error('Кнопка foundCity не имеет границ');
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
