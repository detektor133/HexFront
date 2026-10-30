import { expect, test } from '@playwright/test';

import { DRAG_SLOP_PX } from '../../src/render/gesture.ts';
import { tokens } from '../../src/theme/tokens.ts';

test('@layout T17bfe: рамка выбора появляется при перетаскивании и скрывается после отпускания', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dev/map?map=small&scale=1');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('scale')).not.toHaveText('—');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('карта не имеет границ');

  // Масштаб 1 центрирует карту в области canvas; действие начинается в её центре.
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const delta = DRAG_SLOP_PX;
  const end = { x: start.x + delta, y: start.y + delta };
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
  const expectedColor = tokens.selection.color
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16))
    .join(', ');
  expect(await frame.evaluate((element) => getComputedStyle(element).borderColor)).toBe(
    `rgb(${expectedColor})`,
  );

  await page.mouse.up();
  await expect(frame).toBeHidden();
});
