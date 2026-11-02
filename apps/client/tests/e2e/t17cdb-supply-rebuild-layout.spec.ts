import { expect, test } from '@playwright/test';

for (const width of [1024, 1920] as const) {
  test(`@layout 07/T17cdb: кнопка связи рядом со статусом без перекрытий при ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dev/sandbox?map=small&seed=42&select=765&cityCard=rebuild');

    const card = page.locator('section[aria-label]').filter({
      has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
    });
    await expect(card).toBeVisible();
    await expect(card.locator('h2')).toContainText(/city|capital|город|столица/i);

    const status = card.locator('p').filter({ hasText: /isolated|connected|изолирован|связан/i });
    await expect(status).toBeVisible();
    const rebuild = card.getByRole('button', { name: /build road|проложить дорогу/i });
    await expect(rebuild).toBeVisible();
    await expect(rebuild).toHaveAttribute('title', /build road|проложить дорогу/i);
    await expect(rebuild).toBeEnabled();
    await expect(rebuild.locator('xpath=..')).toHaveClass(/levelAction/u);
    await expect(rebuild.locator('xpath=../../p')).toBeVisible();

    const [statusBox, buttonBox, cardBox] = await Promise.all([
      status.boundingBox(),
      rebuild.boundingBox(),
      card.boundingBox(),
    ]);
    expect(statusBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    if (!statusBox || !buttonBox || !cardBox) throw new Error('Строка или карточка без границ');
    expect(buttonBox.x).toBeGreaterThanOrEqual(statusBox.x + statusBox.width);
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(statusBox.y + statusBox.height).toBeLessThanOrEqual(buttonBox.y + buttonBox.height);
  });
}
