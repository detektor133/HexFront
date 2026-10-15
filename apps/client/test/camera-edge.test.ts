import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { centerCameraOnPoint, clampCamera, insetViewport, minScale } from '../src/render/camera.ts';
import { hexCenter, mapBounds } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

interface MapFixture {
  readonly width: number;
  readonly height: number;
}

const maps: readonly [string, MapFixture][] = ['small', 'perf-4000'].map((id) => [
  id,
  JSON.parse(
    readFileSync(new URL(`../../../packages/mapgen/maps/${id}.json`, import.meta.url), 'utf8'),
  ) as MapFixture,
]);

const viewports = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
] as const;

describe('край карты и океан', () => {
  it('Критерий 1: центрирует каждый угловой гекс small и perf-4000 на всех экранах и масштабах', () => {
    for (const [, map] of maps) {
      const corners = [
        { q: 0, r: 0 },
        { q: map.width - 1, r: 0 },
        { q: 0, r: map.height - 1 },
        { q: map.width - 1, r: map.height - 1 },
      ] as const;

      for (const view of viewports) {
        const visible = insetViewport(view, 88, 150);
        const bounds = mapBounds(map.width, map.height, tokens.map.hexRadius);
        for (const scale of [minScale(visible, bounds), tokens.map.zoom.max]) {
          for (const hex of corners) {
            const point = hexCenter(hex, tokens.map.hexRadius);
            const camera = centerCameraOnPoint(point, scale, visible);
            const clamped = clampCamera(camera, visible, bounds);

            // Центр мира в экранных координатах: (видимая ширина / 2, верхний отступ + высота / 2).
            const expectedX = visible.width / 2 - point.x * scale;
            const expectedY = visible.top + visible.height / 2 - point.y * scale;
            expect(camera.x).toBeCloseTo(expectedX, 6);
            expect(camera.y).toBeCloseTo(expectedY, 6);
            expect(clamped).toEqual(camera);
          }
        }
      }
    }
  });

  it('Критерий 2: insetViewport вычитает HUD сверху и нижнюю панель снизу', () => {
    expect(insetViewport({ width: 1440, height: 900 }, 88, 150)).toEqual({
      width: 1440,
      height: 662,
      top: 88,
    });
  });

  it('Критерий 3: фон Pixi равен map.water, а край карты использует map.waterEdge', () => {
    const source = readFileSync(new URL('../src/render/map-view.ts', import.meta.url), 'utf8');

    expect(source).toContain('background: tokens.map.water');
    expect(source).toContain('tokens.map.waterEdge');
    expect(tokens.map.water).not.toBe(tokens.map.background);
  });
});
