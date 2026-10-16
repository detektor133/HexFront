// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';
import { useSandbox, type Loaded } from '../src/match/MatchSurfaceRuntime.tsx';
import { applyStartCamera } from '../src/match/start-camera.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const runtimeTestState = vi.hoisted(() => ({
  centerOn: vi.fn(),
  setScale: vi.fn(),
  message: null as unknown,
}));

vi.mock('../src/render/map-view.ts', () => ({
  createMapView: vi.fn(async () => ({
    centerOn: runtimeTestState.centerOn,
    setScale: runtimeTestState.setScale,
    setBottomInset: vi.fn(),
    setTopInset: vi.fn(),
    setStroke: vi.fn(),
    setSelection: vi.fn(),
    setGrab: vi.fn(),
    setOrderHooks: vi.fn(),
    cancel: vi.fn(),
    sceneStats: vi.fn(() => ({
      objects: 0,
      text: 0,
      graphics: 0,
      graphicsInstructions: [],
      graphicsDetails: [],
      textures: 0,
      canvasTextTextures: null,
    })),
    destroy: vi.fn(),
  })),
}));

vi.mock('../src/local/local-match.ts', () => ({
  startLocalMatch: vi.fn((_map, _seed, _setup, onMessage) => {
    onMessage(runtimeTestState.message as never);
    return {
      send: vi.fn(),
      setFog: vi.fn(),
      setPaused: vi.fn(),
      step: vi.fn(),
      setSpeed: vi.fn(),
      setObserver: vi.fn(),
      setView: vi.fn(),
      select: vi.fn(),
      ack: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

const playerCity = { q: 4, r: 3 } as const;
const playerUnitHexes = [
  { q: 3, r: 3 },
  { q: 4, r: 4 },
] as const;
const nearbyHexes = [
  { q: 3, r: 2 },
  { q: 5, r: 3 },
] as const;

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

const loadedMap = createLocalEngine(mapJson, 42, 2);
if ('errors' in loadedMap) throw new Error(loadedMap.errors.join('; '));

const mapLoaded: Loaded = {
  json: mapJson,
  map: loadedMap.state.map,
};

describe('стартовая камера матча', () => {
  afterEach(() => {
    cleanup();
    runtimeTestState.centerOn.mockClear();
    runtimeTestState.setScale.mockClear();
  });

  it('Критерий 1: старт матча центрирует камеру на городе государства игрока', async () => {
    const snapshot = loadedMap.snapshot();
    runtimeTestState.message = snapshot;
    const host = document.createElement('div');
    const loaded: Loaded = mapLoaded;

    renderHook(() =>
      useSandbox({ current: host }, loaded, { id: 'small', seed: 42, players: 2 }, false),
    );
    await Promise.resolve();

    const city = snapshot.view.cities.find((item) => item.owner === snapshot.view.playerId);
    if (!city) throw new Error('В снимке нет города игрока');
    expect(runtimeTestState.centerOn).toHaveBeenCalledOnce();
    expect(runtimeTestState.centerOn).toHaveBeenCalledWith(
      hexFromId(city.hex, mapLoaded.map.width),
    );
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
