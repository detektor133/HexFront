import { expect, test } from '@playwright/test';

for (const width of [360, 1024] as const) {
  for (const [cardKind, closeName] of [
    ['unitCard=1', /Close unit card|Закрыть карточку отряда/],
    ['select=0', /Close hex card|Закрыть карточку клетки/],
  ] as const) {
    test(`@layout 07/T17bj: крестик ${cardKind} не перекрывает заголовок при ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/sandbox?map=small&seed=42&${cardKind}`);
      const onboardingButton = page.getByRole('button', { name: 'Понятно' });
      if (await onboardingButton.isVisible()) await onboardingButton.click();
      await page.getByRole('combobox', { name: 'Observer' }).selectOption('0');
      const button = page.getByRole('button', { name: closeName });
      const card = button.locator('xpath=ancestor::section[@aria-label]');
      await expect(card).toBeVisible();
      await expect(button).toBeVisible();
      await expect(button).toHaveAccessibleName(/.+/);
      const icon = button.locator('svg');
      const [cardBox, buttonBox, headingBox, iconBox, buttonStyle] = await Promise.all([
        card.boundingBox(),
        button.boundingBox(),
        card.locator('h2').boundingBox(),
        icon.boundingBox(),
        button.evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          borderWidth: getComputedStyle(element).borderWidth,
        })),
      ]);

      expect(cardBox).not.toBeNull();
      expect(buttonBox).not.toBeNull();
      expect(headingBox).not.toBeNull();
      expect(iconBox).not.toBeNull();
      if (!cardBox || !buttonBox || !headingBox || !iconBox)
        throw new Error('элемент карточки не имеет границ');
      expect(cardBox.x).toBeGreaterThanOrEqual(0);
      expect(cardBox.y).toBeGreaterThanOrEqual(0);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width);
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(900);
      expect(iconBox.width).toBe(16);
      expect(iconBox.height).toBe(16);
      expect(buttonBox.width).toBeGreaterThanOrEqual(44);
      expect(buttonBox.height).toBeGreaterThanOrEqual(44);
      expect(buttonStyle.background).toBe('rgba(0, 0, 0, 0)');
      expect(buttonStyle.borderWidth).toBe('0px');
      expect(buttonBox.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(buttonBox.y).toBeGreaterThanOrEqual(cardBox.y);
      expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
      expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
      expect(
        buttonBox.x + buttonBox.width <= headingBox.x ||
          headingBox.x + headingBox.width <= buttonBox.x ||
          buttonBox.y + buttonBox.height <= headingBox.y ||
          headingBox.y + headingBox.height <= buttonBox.y,
      ).toBe(true);
    });
  }
}
