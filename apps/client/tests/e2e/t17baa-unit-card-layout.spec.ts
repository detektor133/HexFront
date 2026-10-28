import { expect, test } from '@playwright/test';

test('@layout 07/T17baa: кнопка закрытия карточки отряда имеет область 44×44 px и не перекрывает заголовок', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dev/sandbox?map=small&seed=42&unitCard=1');
  const onboardingButton = page.getByRole('button', { name: 'Понятно' });
  if (await onboardingButton.isVisible()) await onboardingButton.click();
  await page.getByRole('combobox', { name: 'Observer' }).selectOption('0');
  const card = page
    .locator('section[aria-label]')
    .filter({ has: page.locator('h2') })
    .last();
  await expect(card).toBeVisible();
  const button = card.getByRole('button').first();
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleName(/.+/);
  const heading = card.locator('h2');
  const [cardBox, buttonBox, headingBox] = await Promise.all([
    card.boundingBox(),
    button.boundingBox(),
    heading.boundingBox(),
  ]);

  expect(cardBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  if (!cardBox || !buttonBox || !headingBox) throw new Error('элемент карточки не имеет границ');
  expect(buttonBox.width).toBeGreaterThanOrEqual(44);
  expect(buttonBox.height).toBeGreaterThanOrEqual(44);
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
