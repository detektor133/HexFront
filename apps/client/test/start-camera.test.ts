import { describe, expect, it, vi } from 'vitest';

import { applyStartCamera } from '../src/match/start-camera.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const playerCity = { q: 4, r: 3 } as const;
const playerUnitHexes = [
  { q: 3, r: 3 },
  { q: 4, r: 4 },
] as const;
const nearbyHexes = [
  { q: 3, r: 2 },
  { q: 5, r: 3 },
] as const;

describe('стартовая камера матча', () => {
  it('Критерий 1: центрирует камеру на городе государства игрока', () => {
    const centerOn = vi.fn();
    const setScale = vi.fn();

    applyStartCamera({
      mapView: { centerOn, setScale },
      playerCity,
      playerUnitHexes,
      nearbyHexes,
    });

    expect(centerOn).toHaveBeenCalledOnce();
    expect(centerOn).toHaveBeenCalledWith(playerCity);
  });

  it('Критерий 2: видимая область содержит город, фишки и ближайшие гексы', () => {
    const viewport = { width: 640, height: 480 } as const;
    const cameraState: { center: typeof playerCity | null; scale: number | null } = {
      center: null,
      scale: null,
    };

    applyStartCamera({
      mapView: {
        centerOn: vi.fn((hex) => {
          cameraState.center = hex;
        }),
        setScale: vi.fn((scale: number) => {
          cameraState.scale = scale;
        }),
      },
      playerCity,
      playerUnitHexes,
      nearbyHexes,
    });

    if (cameraState.center === null || cameraState.scale === null) {
      throw new Error('Стартовая камера не получила центр и масштаб');
    }
    const scale = cameraState.scale;
    const center = hexCenter(cameraState.center, tokens.map.hexRadius);
    const visible = [playerCity, ...playerUnitHexes, ...nearbyHexes].filter((hex) => {
      const point = hexCenter(hex, tokens.map.hexRadius);
      const screen = {
        x: viewport.width / 2 + (point.x - center.x) * scale,
        y: viewport.height / 2 + (point.y - center.y) * scale,
      };
      const margin = tokens.map.hexRadius * scale;
      return (
        screen.x >= -margin &&
        screen.x <= viewport.width + margin &&
        screen.y >= -margin &&
        screen.y <= viewport.height + margin
      );
    });

    expect(visible).toEqual([playerCity, ...playerUnitHexes, ...nearbyHexes]);
  });

  it('Критерий 3: стартовый зум берётся из существующих токенов камеры, без нового числа', () => {
    const setScale = vi.fn();
    applyStartCamera({
      mapView: { centerOn: vi.fn(), setScale },
      playerCity,
      playerUnitHexes,
      nearbyHexes,
    });

    expect(setScale).toHaveBeenCalledOnce();
    expect([tokens.map.zoom.max, ...tokens.map.zoom.detailThresholds]).toContain(
      setScale.mock.calls[0]?.[0],
    );
  });
});
