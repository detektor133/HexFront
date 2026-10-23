import { expect, test } from '@playwright/test';

import { RADIAL_MENU_LONG_PRESS_MS } from '../../src/render/gesture.ts';

test('@layout T17as: pointerdown на canvas, удержание, pointermove в HTML-кнопку и pointerup отправляют merge', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const commands: unknown[] = [];
    (window as Window & { __t17asCommands?: unknown[] }).__t17asCommands = commands;
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function postMessageWithTrace(message: unknown): void {
      if (
        typeof message === 'object' &&
        message !== null &&
        't' in message &&
        message.t === 'command'
      ) {
        const command = 'cmd' in message ? message.cmd : undefined;
        if (command) commands.push(command);
      }
      postMessage.call(this, message);
    };
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/match?debug=1&map=small&speed=0');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500);
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Карта не имеет границ');

  const hudBounds = await page.getByRole('banner').boundingBox();
  const dockBounds = await page.locator('div[class*="dock"]').boundingBox();
  const leaderboardBounds = await page
    .getByRole('region', { name: /Таблица лидеров|Leaderboard/i })
    .boundingBox();
  if (!hudBounds || !dockBounds || !leaderboardBounds)
    throw new Error('Рабочая область карты не имеет границ');
  const mapTop = Math.max(bounds.y, hudBounds.y + hudBounds.height);
  const mapBottom = Math.min(bounds.y + bounds.height, dockBounds.y);
  const rightInset = leaderboardBounds.width + 24;
  const centerX = bounds.x + (bounds.width - rightInset) / 2;
  const centerY = mapTop + (mapBottom - mapTop) / 2 + 20;
  const mergeButton = page.getByRole('menuitem', { name: /Слить|Merge/i });
  let pressPoint: { x: number; y: number } | undefined;
  let opened = false;
  for (const [offsetX, offsetY] of [
    [0, 0],
    [-20, 0],
    [20, 0],
    [0, -20],
    [0, 20],
  ]) {
    const point = { x: centerX + offsetX, y: centerY + offsetY };
    pressPoint = point;
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.waitForTimeout(RADIAL_MENU_LONG_PRESS_MS + 10);
    if (await mergeButton.isVisible().catch(() => false)) {
      opened = true;
      break;
    }
    await page.mouse.up();
  }
  expect(opened).toBe(true);
  if (!pressPoint) throw new Error('Точка нажатия не зафиксирована');
  const menuBounds = await page.getByRole('menu').boundingBox();
  if (!menuBounds) throw new Error('Контекстное меню не имеет границ');
  expect(menuBounds.x + menuBounds.width / 2).toBeCloseTo(pressPoint.x, 0);
  expect(menuBounds.y + menuBounds.height / 2).toBeCloseTo(pressPoint.y, 0);
  const buttonBounds = await mergeButton.boundingBox();
  if (!buttonBounds) throw new Error('Кнопка merge не имеет границ');
  await page.mouse.move(
    buttonBounds.x + buttonBounds.width / 2,
    buttonBounds.y + buttonBounds.height / 2,
  );
  await page.mouse.up();

  await expect(page.getByRole('menu')).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __t17asCommands?: Array<{ t?: string }> }).__t17asCommands?.some(
            (command) => command.t === 'merge',
          ) ?? false,
      ),
    )
    .toBe(true);
});
