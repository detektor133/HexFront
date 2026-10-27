import { expect, test } from '@playwright/test';

test('@layout 07/T17baa: кнопка закрытия карточки отряда имеет область 44×44 px и не перекрывает заголовок', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dev/sandbox?map=small&seed=42');
  const onboardingButton = page.getByRole('button', { name: 'Понятно' });
  if (await onboardingButton.isVisible()) await onboardingButton.click();
  await page.getByRole('combobox', { name: 'Observer' }).selectOption('1');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const mapBox = await canvas.boundingBox();
  if (!mapBox) throw new Error('карта не имеет границ');
  const start = { x: mapBox.x + mapBox.width * 0.25, y: mapBox.y + mapBox.height * 0.25 };
  const end = { x: mapBox.x + mapBox.width * 0.75, y: mapBox.y + mapBox.height * 0.75 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();

  const card = page
    .locator('section[aria-label]')
    .filter({ has: page.locator('h2') })
    .last();
  await expect(card).toBeVisible();
  const button = card.getByRole('button').first();
  await expect(button).toBeVisible();
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
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(headingBox.x);
});
