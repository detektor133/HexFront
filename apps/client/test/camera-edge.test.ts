import { readFileSync } from 'node:fs';

import { Graphics, type Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { loadMap, type MapStatic } from '@hexfront/sim';

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<Record<string, unknown>>();
  const PixiContainer = pixi.Container as typeof Container;

  class TestApplication {
    readonly canvas: HTMLCanvasElement = {
      style: {},
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: () => undefined,
    } as unknown as HTMLCanvasElement;
    readonly stage: Container = new PixiContainer();
    readonly ticker = {
      callbacks: [] as Array<(ticker: { readonly deltaMS: number; readonly FPS: number }) => void>,
      add: (callback: (ticker: { readonly deltaMS: number; readonly FPS: number }) => void) => {
        this.ticker.callbacks.push(callback);
      },
    };
    readonly renderer = { texture: { managedTextures: [] as readonly unknown[] } };
    screen = { width: 390, height: 844 };
    options: { background?: string } = {};

    constructor() {
      (globalThis as Record<string, unknown>).__lastTestApplication = this;
    }

    async init(options: {
      readonly resizeTo: { clientWidth?: number; clientHeight?: number };
      readonly background?: string;
    }): Promise<void> {
      this.options = options;
      this.screen = {
        width: options.resizeTo.clientWidth ?? 390,
        height: options.resizeTo.clientHeight ?? 844,
      };
    }

    destroy(): void {}
  }

  return { ...pixi, Application: TestApplication };
});

import { clampCamera, insetViewport, minScale } from '../src/render/camera.ts';
import { hexCenter, mapBounds } from '../src/render/hex-geometry.ts';
import { createMapView } from '../src/render/map-view.ts';
import { tokens } from '../src/theme/tokens.ts';

interface TestApplication {
  readonly stage: Container;
  readonly ticker: {
    readonly callbacks: ReadonlyArray<
      (ticker: { readonly deltaMS: number; readonly FPS: number }) => void
    >;
  };
  readonly options: { readonly background?: string };
}

const testApplication = (): TestApplication =>
  (globalThis as Record<string, unknown>).__lastTestApplication as TestApplication;

Object.defineProperty(globalThis, 'window', { value: { devicePixelRatio: 1 } });

const maps: readonly MapStatic[] = ['small', 'perf-4000'].map((id) => {
  const loaded = loadMap(
    JSON.parse(
      readFileSync(new URL(`../../../packages/mapgen/maps/${id}.json`, import.meta.url), 'utf8'),
    ) as unknown,
  );
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  return loaded.map;
});

const viewports = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
] as const;

const hostFor = (view: { readonly width: number; readonly height: number }): HTMLElement =>
  ({
    clientWidth: view.width,
    clientHeight: view.height,
    appendChild: () => undefined,
  }) as unknown as HTMLElement;

const sceneGraphics = (node: Container): Graphics[] => [
  ...(node instanceof Graphics ? [node] : []),
  ...node.children.flatMap((child) => sceneGraphics(child)),
];

describe('край карты и океан', () => {
  it('Критерий 1: центрирует каждый угловой гекс через MapView.centerOn', async () => {
    for (const map of maps) {
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
            const states: Array<{ readonly scale: number }> = [];
            const mapView = await createMapView(
              hostFor(view),
              map,
              { radius: tokens.map.hexRadius, midLayer: null },
              (state) => states.push(state),
            );
            mapView.setTopInset(88);
            mapView.setBottomInset(150);
            mapView.setScale(scale);
            mapView.centerOn(hex);

            const app = testApplication();
            const world = app.stage.children[0] as Container;
            for (const callback of app.ticker.callbacks) callback({ deltaMS: 0, FPS: 60 });

            const point = hexCenter(hex, tokens.map.hexRadius);
            const camera = { scale, x: world.position.x, y: world.position.y };
            const clamped = clampCamera(camera, visible, bounds);
            const expectedX = visible.width / 2 - point.x * scale;
            const expectedY = visible.top + visible.height / 2 - point.y * scale;

            expect(Math.abs(camera.x - expectedX)).toBeLessThanOrEqual(1);
            expect(Math.abs(camera.y - expectedY)).toBeLessThanOrEqual(1);
            expect(clamped).toEqual(camera);
            expect(states.at(-1)?.scale).toBeCloseTo(scale, 6);
            mapView.destroy();
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

  it('Критерий 3: Pixi получает фон воды и рисует берег цветом waterEdge', async () => {
    const smallMap = maps[0];
    if (!smallMap) throw new Error('Карта small не загружена');
    const mapView = await createMapView(
      hostFor(viewports[0]),
      smallMap,
      { radius: tokens.map.hexRadius, midLayer: null },
      () => undefined,
    );
    const app = testApplication();
    const graphics = sceneGraphics(app.stage);
    const instructions = graphics.flatMap((graphic) => graphic.context.instructions);

    expect(app.options.background).toBe(tokens.map.water);
    expect(
      instructions.some((instruction) => {
        const data = (instruction as { data: { style?: { color?: unknown } } }).data;
        return data.style?.color === Number.parseInt(tokens.map.waterEdge.slice(1), 16);
      }),
    ).toBe(true);
    expect(tokens.map.water).not.toBe(tokens.map.background);
    mapView.destroy();
  });
});
