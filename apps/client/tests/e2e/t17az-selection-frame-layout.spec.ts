import { expect, test } from '@playwright/test';

test('@layout T17az: рамка выбора появляется при перетаскивании и очищается после отпускания', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dev/map?map=small&scale=1');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('карта не имеет границ');

  const start = { x: bounds.x + bounds.width * 0.35, y: bounds.y + bounds.height * 0.35 };
  const end = { x: bounds.x + bounds.width * 0.65, y: bounds.y + bounds.height * 0.65 };
  const frame = page.getByTestId('selection-frame');

  await expect(frame).toBeHidden();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await expect(frame).toBeVisible();
  const frameBounds = await frame.boundingBox();
  expect(frameBounds).not.toBeNull();
  expect(frameBounds?.width).toBeGreaterThan(0);
  expect(frameBounds?.height).toBeGreaterThan(0);

  await page.mouse.up();
  await expect(frame).toBeHidden();
});
