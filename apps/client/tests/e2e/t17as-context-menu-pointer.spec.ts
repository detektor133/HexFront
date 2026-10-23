import { expect, test } from '@playwright/test';

import { RADIAL_MENU_LONG_PRESS_MS } from '../../src/render/gesture.ts';

function playerCapitalPoint(
  canvas: { x: number; y: number; width: number; height: number },
  hud: { y: number; height: number },
  dock: { y: number },
  leaderboard: { width: number },
  q: number,
  r: number,
): { x: number; y: number } {
  const radius = 20;
  const worldWidth = radius * 1.5 * 39 + radius * 2;
  const worldHeight = radius * Math.sqrt(3) * 29 + radius * Math.sqrt(3);
  const top = Math.max(canvas.y, hud.y + hud.height);
  const bottom = Math.min(canvas.y + canvas.height, dock.y);
  const viewWidth = canvas.width - leaderboard.width - 24;
  const viewHeight = bottom - top;
  const scale = Math.min(canvas.width / worldWidth, canvas.height / worldHeight);
  const cameraX = Math.min(
    radius * scale,
    Math.max(viewWidth - (worldWidth - radius * 2) * scale, 0),
  );
  const cameraY = Math.min(
    top + radius * Math.sqrt(3) * scale,
    Math.max(top + viewHeight - (worldHeight - radius * Math.sqrt(3)) * scale, 0),
  );
  return {
    x: cameraX + radius * 1.5 * q * scale,
    y: cameraY + radius * Math.sqrt(3) * (r + q / 2) * scale,
  };
}

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
  const mergeButton = page.getByRole('menuitem', { name: /Слить|Merge/i });
  let pressPoint: { x: number; y: number } | undefined;
  let opened = false;
  for (const [q, r] of [
    [5, 0],
    [20, -5],
    [34, -14],
    [5, 16],
    [22, 11],
    [34, 2],
  ]) {
    const capital = playerCapitalPoint(bounds, hudBounds, dockBounds, leaderboardBounds, q, r);
    for (const [offsetX, offsetY] of [
      [0, 0],
      [-8, 0],
      [8, 0],
      [0, -8],
      [0, 8],
    ]) {
      const point = { x: capital.x + offsetX, y: capital.y + offsetY };
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
    if (opened) break;
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

test('@layout T17as: pointer-сценарии через canvas отправляют assignUnits, split и bombard', async ({
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
  // bombard нужна артиллерия: отдельный явный флаг, не завязка на debug (07/T17as, docs/QUESTIONS.md).
  await page.goto('/match?debug=1&map=small&speed=0&fixture=artillery');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500);
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Карта не имеет границ');

  const commandTypes = async (): Promise<string[]> =>
    page.evaluate(() =>
      ((window as Window & { __t17asCommands?: Array<{ t?: string }> }).__t17asCommands ?? [])
        .map((command) => command.t)
        .filter((type): type is string => type !== undefined),
    );
  const openMenu = async (x: number, y: number): Promise<boolean> => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(RADIAL_MENU_LONG_PRESS_MS + 10);
    return page
      .getByRole('menu')
      .isVisible()
      .catch(() => false);
  };
  const releaseOn = async (name: RegExp): Promise<void> => {
    const button = page.getByRole('menuitem', { name });
    const buttonBounds = await button.boundingBox();
    if (!buttonBounds) throw new Error('Кнопка меню не имеет границ');
    await page.mouse.move(
      buttonBounds.x + buttonBounds.width / 2,
      buttonBounds.y + buttonBounds.height / 2,
    );
    await page.mouse.up();
  };
  const openCenterMenu = async (): Promise<void> => {
    const hudBounds = await page.getByRole('banner').boundingBox();
    const dockBounds = await page.locator('div[class*="dock"]').boundingBox();
    const leaderboardBounds = await page
      .getByRole('region', { name: /Таблица лидеров|Leaderboard/i })
      .boundingBox();
    if (!hudBounds || !dockBounds || !leaderboardBounds)
      throw new Error('Рабочая область карты не имеет границ');
    for (const [q, r] of [
      [5, 0],
      [20, -5],
      [34, -14],
      [5, 16],
      [22, 11],
      [34, 2],
    ]) {
      const capital = playerCapitalPoint(bounds, hudBounds, dockBounds, leaderboardBounds, q, r);
      for (const [offsetX, offsetY] of [
        [0, 0],
        [-8, 0],
        [8, 0],
        [0, -8],
        [0, 8],
      ]) {
        if (await openMenu(capital.x + offsetX, capital.y + offsetY)) return;
        await page.mouse.up();
      }
    }
    throw new Error('Контекстное меню фишки не найдено в центре карты');
  };

  await openCenterMenu();
  await releaseOn(/В армию|To army/i);
  await releaseOn(/Резерв|Reserve/i);
  await expect.poll(commandTypes).toContain('assignUnits');

  await page.reload();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500);
  await openCenterMenu();
  await releaseOn(/Разделить|Split/i);
  await expect.poll(commandTypes).toContain('split');

  await page.reload();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500);
  let bombardFound = false;
  for (let row = 1; row <= 4 && !bombardFound; row += 1) {
    for (let column = 1; column <= 6 && !bombardFound; column += 1) {
      const x = bounds.x + (bounds.width * column) / 7;
      const y = bounds.y + (bounds.height * row) / 5;
      if (!(await openMenu(x, y))) {
        await page.mouse.up();
        continue;
      }
      const bombard = page.getByRole('menuitem', { name: /Автоцель|Auto fire/i });
      if (await bombard.isVisible().catch(() => false)) {
        await releaseOn(/Автоцель|Auto fire/i);
        bombardFound = true;
      } else {
        await page.mouse.up();
        await page.keyboard.press('Escape');
      }
    }
  }
  expect(bombardFound).toBe(true);
  await expect.poll(commandTypes).toContain('bombard');
});
