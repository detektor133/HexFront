// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import type { Container as PixiContainer } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hexFromId,
  hexId,
  inBounds,
  loadMap,
  neighbors,
  TERRAIN,
  type Fp,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { createSplitGrab } from '../src/dev/split-drag.ts';
import { createUnitLayer } from '../src/dev/unit-layer.ts';
import {
  createPickedState,
  createSandboxPicker,
  createSandboxGrab,
  tapUnit,
} from '../src/dev/unit-selection.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter, type Point } from '../src/render/hex-geometry.ts';
import { createMapView, type MapView } from '../src/render/map-view.ts';
import { tokens } from '../src/theme/tokens.ts';

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<Record<string, unknown>>();
  class TestApplication {
    readonly canvas = document.createElement('canvas');
    readonly stage: PixiContainer = new (pixi.Container as typeof PixiContainer)();
    readonly ticker = {
      FPS: 60,
      callbacks: [] as Array<(tick: { deltaMS: number; FPS: number }) => void>,
      add: (callback: (tick: { deltaMS: number; FPS: number }) => void) => {
        this.ticker.callbacks.push(callback);
      },
    };
    readonly renderer = { texture: { managedTextures: [] as unknown[] } };
    readonly screen = { width: 1000, height: 800 };
    constructor() {
      (globalThis as Record<string, unknown>).__lastTestApplication = this;
    }
    async init(): Promise<void> {}
    destroy(): void {}
  }
  return { ...pixi, Application: TestApplication };
});

const mapJson: unknown = JSON.parse(readFileSync('packages/mapgen/maps/tiny.json', 'utf8'));
const loaded = loadMap(mapJson);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const map: MapStatic = loaded.map;

afterEach(() => vi.restoreAllMocks());

describe('07/T17bu: ввод карты и выбор отдельной фишки', () => {
  it('преобразует экранные координаты камерой, выбирает три фишки, игнорирует промежуток и сохраняет unitId при splitGrab', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal(
      'PointerEvent',
      class extends MouseEvent {
        readonly pointerId: number;
        readonly pointerType: string;
        constructor(
          type: string,
          init: MouseEventInit & { pointerId?: number; pointerType?: string },
        ) {
          super(type, init);
          this.pointerId = init.pointerId ?? 0;
          this.pointerType = init.pointerType ?? 'mouse';
        }
      },
    );
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const view = engine.snapshot().view;
    const units = view.units.filter((unit) => unit.owner === view.playerId).slice(0, 2);
    const first = units[0];
    if (!first || !units[1]) throw new Error('Фикстуре нужны два исходных отряда');
    const third = { ...first, id: first.id + 10_000, type: 'artillery' as const };
    const nextHex = neighbors(hexFromId(first.hex, map.width)).find(
      (hex) =>
        inBounds(hex, map.width, map.height) &&
        map.terrain[hexId(hex, map.width)] !== TERRAIN.water,
    );
    if (!nextHex) throw new Error('Для движущейся фишки нужен соседний сухопутный гекс');
    const nextHexId = hexId(nextHex, map.width);
    const testView = {
      ...view,
      units: [
        {
          ...first,
          soldiers: 1000_000 as Fp,
          order: 'move' as const,
          moveTicks: 9,
          moveTotal: 10,
          path: [nextHexId],
        },
        {
          ...units[1],
          hex: first.hex,
          soldiers: 1200_000 as Fp,
          order: 'idle' as const,
          moveTotal: 0,
          path: [],
        },
        {
          ...third,
          soldiers: 1500_000 as Fp,
          order: 'idle' as const,
          moveTotal: 0,
          path: [],
        },
      ],
    };
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 1000 });
    Object.defineProperty(host, 'clientHeight', { value: 800 });
    document.body.append(host);
    const pickedRef = createPickedState();
    const pick = createSandboxPicker(pickedRef, () => undefined);
    const layer = createUnitLayer(map.width, tokens.map.hexRadius, (hex) =>
      hexCenter(hexFromId(hex, map.width), tokens.map.hexRadius),
    );
    layer.setView(testView, { hex: null, units: [], target: null }, 0);
    const mapView: MapView = await createMapView(
      host,
      map,
      {
        radius: tokens.map.hexRadius,
        midLayer: () => ({
          container: layer.container,
          update: (scale: number) => layer.setScale(scale),
          frame: (nowMs: number) => layer.frame(nowMs),
          destroy: () => layer.destroy(),
        }),
      },
      () => undefined,
      (_hex, _kind, world) => {
        const next = tapUnit(world, testView, pickedRef.current, layer);
        if (next) pick(next);
      },
    );
    mapView.setScale(1.35);
    const testApp = (globalThis as Record<string, unknown>).__lastTestApplication as {
      ticker: { callbacks: ReadonlyArray<(tick: { deltaMS: number; FPS: number }) => void> };
    };
    for (const callback of testApp.ticker.callbacks) callback({ deltaMS: 0, FPS: 60 });
    const canvas = host.querySelector('canvas');
    if (!canvas) throw new Error('Canvas карты не создан');
    canvas.setPointerCapture = () => undefined;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({
        left: 37,
        top: 53,
        x: 37,
        y: 53,
        right: 1037,
        bottom: 853,
        width: 1000,
        height: 800,
        toJSON: () => ({}),
      }),
    });
    const app = (globalThis as Record<string, unknown>).__lastTestApplication as {
      stage: PixiContainer;
    };
    const camera = app.stage.children[0];
    if (!camera) throw new Error('Камера карты не создана');
    const screenPoint = (world: Point): Point => ({
      x: 37 + world.x * camera.scale.x + camera.position.x,
      y: 53 + world.y * camera.scale.y + camera.position.y,
    });
    const click = (point: Point): void => {
      const init = {
        pointerId: 1,
        button: 0,
        pointerType: 'mouse',
        clientX: point.x,
        clientY: point.y,
      };
      canvas.dispatchEvent(new PointerEvent('pointerdown', init));
      canvas.dispatchEvent(new PointerEvent('pointerup', init));
    };
    for (const unit of testView.units) {
      const bounds = layer.chipBounds(unit.id);
      if (!bounds) throw new Error(`Фишка ${unit.id} отсутствует`);
      click(
        screenPoint({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }),
      );
      expect(pickedRef.current.units).toEqual([unit.id]);
    }
    const bounds = testView.units.map((unit) => layer.chipBounds(unit.id));
    const b0 = bounds[0];
    const b1 = bounds[1];
    const b2 = bounds[2];
    if (!b0 || !b1 || !b2) throw new Error('Не найдены границы стека');
    const gap = { x: (b1.left + b1.right) / 2, y: (b1.bottom + b2.top) / 2 };
    const selected = pickedRef.current;
    click(screenPoint(gap));
    expect(pickedRef.current).toEqual(selected);

    const selectedBeforeDrag = pickedRef.current;
    const center = layer.chipAt(first.hex);
    const splitCommands: number[] = [];
    const grab = createSplitGrab({
      context: () => ({ map, view: testView as PlayerView, radius: tokens.map.hexRadius }),
      chipAt: () => center,
      send: (command) => {
        if (command.t === 'split') splitCommands.push(command.unitId);
      },
      setOverlay: () => undefined,
    });
    mapView.setGrab(createSandboxGrab(() => null, grab));
    const dragStartWorld = center;
    const dragEndWorld = {
      x: dragStartWorld.x + tokens.map.hexRadius * 1.8,
      y: dragStartWorld.y,
    };
    const dragStart = screenPoint(dragStartWorld);
    const dragEnd = screenPoint(dragEndWorld);
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 2,
        button: 0,
        pointerType: 'mouse',
        clientX: dragStart.x,
        clientY: dragStart.y,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 2,
        button: 0,
        pointerType: 'mouse',
        clientX: dragEnd.x,
        clientY: dragEnd.y,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 2,
        button: 0,
        pointerType: 'mouse',
        clientX: dragEnd.x,
        clientY: dragEnd.y,
      }),
    );
    expect(pickedRef.current).toBe(selectedBeforeDrag);
    expect(pickedRef.current.units).toEqual([testView.units[2]?.id]);
    expect(splitCommands).toEqual([third.id]);
    mapView.destroy();
    host.remove();
  });
});
