import { expect, test } from '@playwright/test';

test('@layout 07/T17babc: кнопка закрытия карточки клетки внутри карточки, не перекрывает заголовок и имеет область 44×44 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dev/sandbox?map=small&seed=42&select=724');

  const card = page
    .locator('section[aria-label]')
    .filter({ has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }) });
  await expect(card).toBeVisible();
  const heading = card.locator('h2');
  await expect(heading).toBeVisible();
  await expect(card).toHaveAttribute('aria-label', (await heading.textContent()) ?? '');

  const button = card.getByRole('button', { name: /close hex card|закрыть карточку клетки/i });
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
