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

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const mergeButton = page.getByRole('menuitem', { name: /Слить|Merge/i });
  let opened = false;
  for (const offsetY of [-100, -75, -50, -25, 0, 25, 50, 75, 100]) {
    await page.mouse.move(centerX, centerY + offsetY);
    await page.mouse.down();
    await page.waitForTimeout(RADIAL_MENU_LONG_PRESS_MS + 10);
    if (await mergeButton.isVisible().catch(() => false)) {
      opened = true;
      break;
    }
    await page.mouse.up();
  }
  expect(opened).toBe(true);
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
