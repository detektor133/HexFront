import { expect, test } from '@playwright/test';

import { hexFromId } from '@hexfront/sim';

import { clampCamera, fitCamera, insetViewport } from '../../src/render/camera.ts';
import { HOLD_MS } from '../../src/render/gesture.ts';
import { hexCenter, mapBounds } from '../../src/render/hex-geometry.ts';
import { tokens } from '../../src/theme/tokens.ts';

test('@layout 07/T17bl: удержание и ведение по гексу не показывают радиальное меню', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/match?map=small&seed=42');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const army = page.locator('[role="button"][class*="pick"]').first();
  await expect(army).toBeVisible();
  await expect(army).toHaveAttribute('aria-pressed', 'false');
  await army.click();
  await expect(army).toHaveAttribute('aria-pressed', 'true');

  const mapResponse = await page.request.get('/maps/small.json');
  expect(mapResponse.ok()).toBe(true);
  const mapJson: unknown = await mapResponse.json();
  if (typeof mapJson !== 'object' || mapJson === null) throw new Error('карта small не загружена');
  const mapData = mapJson as {
    readonly width: number;
    readonly height: number;
    readonly terrain: readonly number[];
  };
  const canvasBounds = await canvas.boundingBox();
  if (!canvasBounds) throw new Error('полотно карты не имеет границ');
  const hud = await page.locator('header').boundingBox();
  const dock = await page.locator('div[class*="_dock_"]').boundingBox();
  if (!hud || !dock) throw new Error('панели матча не имеют границ');

  const radius = tokens.map.hexRadius;
  const bounds = mapBounds(mapData.width, mapData.height, radius);
  const initial = fitCamera({ width: canvasBounds.width, height: canvasBounds.height }, bounds);
  const cameraView = insetViewport(
    { width: canvasBounds.width, height: canvasBounds.height },
    hud.height,
    dock.height,
  );
  const camera = clampCamera(initial, cameraView, bounds);
  const mapCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  let startHex = 0;
  let startPoint = { x: 0, y: 0 };
  let nearest = Number.POSITIVE_INFINITY;
  for (let id = 0; id < mapData.terrain.length; id += 1) {
    if (mapData.terrain[id] === 0) continue;
    const point = hexCenter(hexFromId(id, mapData.width), radius);
    const distance = (point.x - mapCenter.x) ** 2 + (point.y - mapCenter.y) ** 2;
    if (distance < nearest) {
      nearest = distance;
      startHex = id;
      startPoint = point;
    }
  }
  expect(Number.isFinite(nearest)).toBe(true);
  let destinationPoint: { x: number; y: number } | null = null;
  let destinationDistance = Number.POSITIVE_INFINITY;
  for (let id = 0; id < mapData.terrain.length; id += 1) {
    if (id === startHex || mapData.terrain[id] === 0) continue;
    const point = hexCenter(hexFromId(id, mapData.width), radius);
    const distance = Math.hypot(point.x - startPoint.x, point.y - startPoint.y);
    if (distance > 8 && distance < destinationDistance) {
      destinationDistance = distance;
      destinationPoint = point;
    }
  }
  if (!destinationPoint) throw new Error('карта small не содержит соседний доступный гекс');
  const start = {
    x: canvasBounds.x + camera.x + startPoint.x * camera.scale,
    y: canvasBounds.y + camera.y + startPoint.y * camera.scale,
  };
  const destination = {
    x: canvasBounds.x + camera.x + destinationPoint.x * camera.scale,
    y: canvasBounds.y + camera.y + destinationPoint.y * camera.scale,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(HOLD_MS + 30);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.mouse.move(destination.x, destination.y);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByRole('menu')).toHaveCount(0);
});
