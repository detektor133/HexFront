import { expect, test, type Page } from '@playwright/test';

import { cityChipShift } from '../../src/dev/chip-place.ts';
import { clampCamera } from '../../src/render/camera.ts';
import { RADIAL_MENU_LONG_PRESS_MS } from '../../src/render/gesture.ts';
import { hexCenter, mapBounds } from '../../src/render/hex-geometry.ts';
import { tokens } from '../../src/theme/tokens.ts';

/**
 * Матч (и каждый `page.reload()`) стартует в режиме наблюдателя «Whole map» (observerId=null)
 * независимо от debug — у этого вида нет playerId, поэтому `canOpen` контекстного меню не находит
 * ничьих юнитов. Переключение на «Player 1» (HUMAN_ID=0) даёт собственную фишку для удержания.
 */
async function selectHumanPlayer(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: /Observer|Наблюдатель/i }).selectOption('0');
}

type T17asView = {
  playerId: number;
  cities: Array<{ hex: number; owner: number; isCapital: boolean }>;
  units: Array<{
    id: number;
    owner: number;
    hex: number;
    type: string;
    path: number[];
    moveTicks: number;
    moveTotal: number;
  }>;
};

function installT17asTrace(): void {
  const commands: unknown[] = [];
  (window as Window & { __t17asCommands?: unknown[] }).__t17asCommands = commands;
  const workerOnMessage = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage');
  if (!workerOnMessage?.set) throw new Error('Не найден Worker.onmessage');
  Object.defineProperty(Worker.prototype, 'onmessage', {
    configurable: workerOnMessage.configurable,
    enumerable: workerOnMessage.enumerable,
    get: workerOnMessage.get,
    set(handler: ((this: Worker, event: MessageEvent) => void) | null): void {
      workerOnMessage.set?.call(
        this,
        handler
          ? (event: MessageEvent): void => {
              const message = event.data as {
                view?: T17asView;
                snapshot?: { view?: T17asView };
              };
              const view = message.view ?? message.snapshot?.view;
              if (view) {
                const state = window as Window & {
                  __t17asFirstView?: T17asView;
                  __t17asView?: T17asView;
                };
                state.__t17asFirstView ??= view;
                state.__t17asView = view;
              }
              handler.call(this, event);
            }
          : null,
      );
    },
  });
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
}

async function readT17asView(page: Page): Promise<T17asView> {
  return page.evaluate(() => {
    const state = window as Window & { __t17asFirstView?: T17asView; __t17asView?: T17asView };
    const view = state.__t17asFirstView ?? state.__t17asView;
    if (!view) throw new Error('Стартовый снимок игрока не получен');
    return view;
  });
}

function playerUnitPoint(
  canvas: { x: number; y: number; width: number; height: number },
  hud: { y: number; height: number },
  dock: { y: number },
  leaderboard: { width: number },
  capitalHex: number,
  unit: T17asView['units'][number],
): { x: number; y: number } {
  const radius = tokens.map.hexRadius;
  const scale = tokens.map.zoom.detailThresholds[1] ?? tokens.map.zoom.max;
  const world = mapBounds(39, 29, radius);
  const hexPoint = (hex: number): { x: number; y: number } => {
    const q = hex % 39;
    const r = Math.floor(hex / 39) - Math.floor((q + (q & 1)) / 2);
    const point = hexCenter({ q, r }, radius);
    return hex === capitalHex ? { x: point.x, y: point.y + cityChipShift(1, radius) } : point;
  };
  const city = hexPoint(capitalHex);
  const start = hexPoint(unit.hex);
  const next = unit.path[0] === undefined ? start : hexPoint(unit.path[0]);
  const progress = unit.moveTotal > 0 ? unit.moveTicks / unit.moveTotal : 0;
  const unitPoint = {
    x: start.x + (next.x - start.x) * progress,
    y: start.y + (next.y - start.y) * progress,
  };
  const bottomInset = canvas.y + canvas.height - dock.y;
  const topInset = hud.y + hud.height - canvas.y;
  const rightInset = leaderboard.width + 24;
  let camera = clampCamera(
    { scale, x: canvas.width / 2 - city.x * scale, y: canvas.height / 2 - city.y * scale },
    { width: canvas.width, height: canvas.height },
    world,
  );
  camera = clampCamera(camera, { width: canvas.width, height: canvas.height - bottomInset }, world);
  camera = clampCamera(
    {
      ...camera,
    },
    {
      width: canvas.width - rightInset,
      height: canvas.height - topInset - bottomInset,
      top: topInset,
    },
    world,
  );
  return {
    x: canvas.x + camera.x + unitPoint.x * scale,
    y: canvas.y + camera.y + unitPoint.y * scale,
  };
}

test('@layout T17as: pointerdown на canvas, удержание, pointermove в HTML-кнопку и pointerup отправляют merge', async ({
  page,
}) => {
  await page.addInitScript(installT17asTrace);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/match?debug=1&map=small&speed=0');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await selectHumanPlayer(page);
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
  const view = await readT17asView(page);
  const first = view.units.find((unit) => unit.owner === view.playerId);
  if (!first) throw new Error('У игрока нет стартового отряда');
  const capitalHex = view.cities.find(
    (city) => city.owner === view.playerId && city.isCapital,
  )?.hex;
  if (capitalHex === undefined) throw new Error('Столица игрока не найдена');
  const expectedUnitIds = view.units
    .filter(
      (unit) => unit.owner === view.playerId && unit.hex === first.hex && unit.type === first.type,
    )
    .map((unit) => unit.id);
  const capital = playerUnitPoint(
    bounds,
    hudBounds,
    dockBounds,
    leaderboardBounds,
    capitalHex,
    first,
  );
  const mergeButton = page.getByRole('menuitem', { name: /Слить|Merge/i });
  let pressPoint: { x: number; y: number } | undefined;
  let opened = false;
  for (const offset of [
    [0, 0],
    [-8, 0],
    [8, 0],
    [0, -8],
    [0, 8],
  ]) {
    const [offsetX, offsetY] = offset;
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
          (
            window as Window & { __t17asCommands?: Array<{ t?: string; unitIds?: number[] }> }
          ).__t17asCommands?.find((command) => command.t === 'merge') ?? null,
      ),
    )
    .toEqual({ t: 'merge', unitIds: expectedUnitIds });
});

test('@layout T17as: pointer-сценарии через canvas отправляют assignUnits, split и bombard', async ({
  page,
}) => {
  await page.addInitScript(installT17asTrace);
  await page.setViewportSize({ width: 1440, height: 900 });
  // bombard нужна артиллерия: отдельный явный флаг, не завязка на debug (07/T17as, docs/QUESTIONS.md).
  await page.goto('/match?debug=1&map=small&speed=0&fixture=artillery');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await selectHumanPlayer(page);
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
    const view = await readT17asView(page);
    const first = view.units.find((unit) => unit.owner === view.playerId);
    if (!first) throw new Error('У игрока нет стартового отряда');
    const capitalHex = view.cities.find(
      (city) => city.owner === view.playerId && city.isCapital,
    )?.hex;
    if (capitalHex === undefined) throw new Error('Столица игрока не найдена');
    const capital = playerUnitPoint(
      bounds,
      hudBounds,
      dockBounds,
      leaderboardBounds,
      capitalHex,
      first,
    );
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
    throw new Error('Контекстное меню фишки не найдено в центре карты');
  };

  await openCenterMenu();
  await releaseOn(/В армию|To army/i);
  await releaseOn(/Резерв|Reserve/i);
  await expect.poll(commandTypes).toContain('assignUnits');

  await page.reload();
  await expect(canvas).toBeVisible();
  await selectHumanPlayer(page);
  await page.waitForTimeout(500);
  await openCenterMenu();
  await releaseOn(/Разделить|Split/i);
  await expect.poll(commandTypes).toContain('split');

  await page.reload();
  await expect(canvas).toBeVisible();
  await selectHumanPlayer(page);
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
