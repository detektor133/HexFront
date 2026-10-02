import { expect, test, type Page } from '@playwright/test';

const MAP_URL = '/dev/map?map=small&scale=1';

async function readScale(page: Page): Promise<number> {
  return Number(await page.getByTestId('scale').textContent());
}

test('ПК: колесо меняет масштаб, перетаскивание сохраняет карту в пределах экрана', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(MAP_URL);
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('scale')).not.toHaveText('—');

  const before = await readScale(page);
  await page.mouse.move(1000, 650);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => readScale(page)).toBeGreaterThan(before);

  await page.mouse.move(1000, 650);
  await page.mouse.down();
  await page.mouse.move(900, 650);
  await page.mouse.up();
  await expect(page.getByTestId('scale')).not.toHaveText('—');
});

test('телефон: два указателя увеличивают карту и кнопки остаются touch-целями', async ({
  page,
}) => {
  await page.goto(MAP_URL);
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('scale')).not.toHaveText('—');

  const before = await readScale(page);
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('карта не имеет границ');
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await canvas.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'touch',
    button: 0,
    clientX: centerX - 40,
    clientY: centerY,
  });
  await canvas.dispatchEvent('pointerdown', {
    pointerId: 2,
    pointerType: 'touch',
    button: 0,
    clientX: centerX + 40,
    clientY: centerY,
  });
  await canvas.dispatchEvent('pointermove', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: centerX + 100,
    clientY: centerY,
  });
  await canvas.dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch' });
  await canvas.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
  await expect.poll(() => readScale(page)).toBeGreaterThan(before);

  await page.goto('/dev/sandbox');
  const touchTargets = await page.locator('button:visible').evaluateAll((buttons) =>
    buttons.every((button) => {
      const box = button.getBoundingClientRect();
      return box.width >= 44 && box.height >= 44;
    }),
  );
  expect(touchTargets).toBe(true);
});
