import { describe, expect, it } from 'vitest';

import {
  MAX_SCALE,
  clampCamera,
  decayVelocity,
  detailLevel,
  fitCamera,
  minScale,
  zoomAt,
} from '../src/render/camera.ts';
import { mapBounds } from '../src/render/hex-geometry.ts';

const view = { width: 1440, height: 900 };
const world = mapBounds(40, 30, 20);

describe('камера карты', () => {
  it('детализация переключается на порогах 0,6 и 1,5', () => {
    expect(detailLevel(0.3)).toBe(1);
    expect(detailLevel(0.5999)).toBe(1);
    expect(detailLevel(0.6)).toBe(2);
    expect(detailLevel(1.4999)).toBe(2);
    expect(detailLevel(1.5)).toBe(3);
    expect(detailLevel(MAX_SCALE)).toBe(3);
  });

  it('минимальный масштаб показывает всю карту', () => {
    const s = minScale(view, world);
    expect(world.width * s).toBeLessThanOrEqual(view.width + 1e-9);
    expect(world.height * s).toBeLessThanOrEqual(view.height + 1e-9);
    expect(Math.max(world.width * s - view.width, world.height * s - view.height)).toBeCloseTo(
      0,
      6,
    );
  });

  it('масштаб ограничен сверху 2,5 и снизу «вся карта»', () => {
    const fit = fitCamera(view, world);
    expect(zoomAt(fit, 100, 0, 0, view, world).scale).toBe(MAX_SCALE);
    expect(zoomAt(fit, 0.01, 0, 0, view, world).scale).toBe(fit.scale);
  });

  it('зум сохраняет точку карты под курсором', () => {
    const cam = zoomAt(fitCamera(view, world), 2, 700, 450, view, world);
    const worldX = (700 - cam.x) / cam.scale;
    const next = zoomAt(cam, 1.1, 700, 450, view, world);
    expect((700 - next.x) / next.scale).toBeCloseTo(worldX, 6);
  });

  it('край карты нельзя увести внутрь экрана', () => {
    const cam = clampCamera({ scale: 2, x: 5000, y: 5000 }, view, world);
    expect(cam.x).toBeCloseTo(-world.x * 2, 6);
    expect(cam.y).toBeCloseTo(-world.y * 2, 6);
  });

  it('карта меньше экрана центрируется', () => {
    const cam = fitCamera({ width: 390, height: 844 }, world);
    const top = cam.y + world.y * cam.scale;
    const bottom = 844 - (cam.y + (world.y + world.height) * cam.scale);
    expect(top).toBeCloseTo(bottom, 6);
  });

  it('инерция затухает и останавливается', () => {
    let v = decayVelocity({ vx: 2000, vy: 0 }, 16);
    expect(v?.vx).toBeLessThan(2000);
    let frames = 0;
    while (v && frames < 1000) {
      v = decayVelocity(v, 16);
      frames += 1;
    }
    expect(v).toBeNull();
    expect(frames).toBeLessThan(200);
  });
});
