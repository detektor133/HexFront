// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { Container } from 'pixi.js';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap, type Command } from '@hexfront/sim';

import { cityChipShift } from '../src/dev/chip-place.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { MatchSurface } from '../src/match/MatchSurface.tsx';
import { clampCamera } from '../src/render/camera.ts';
import { HOLD_MS } from '../src/render/gesture.ts';
import { hexCenter, mapBounds } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<Record<string, unknown>>();
  const PixiContainer = pixi.Container as typeof Container;
  class TestApplication {
    readonly canvas = document.createElement('canvas');
    readonly stage = new PixiContainer();
    readonly ticker = {
      callbacks: [] as Array<(ticker: { deltaMS: number; FPS: number }) => void>,
      add: (callback: (ticker: { deltaMS: number; FPS: number }) => void): void => {
        this.ticker.callbacks.push(callback);
      },
    };
    readonly renderer = { texture: { managedTextures: [] as readonly unknown[] } };
    screen = { width: 390, height: 844 };
    constructor() {
      (globalThis as Record<string, unknown>).__lastTestApplication = this;
      Object.defineProperty(this.canvas, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0 }),
      });
      Object.defineProperty(this.canvas, 'setPointerCapture', { value: vi.fn() });
    }
    async init(options: {
      readonly resizeTo: { clientWidth?: number; clientHeight?: number };
    }): Promise<void> {
      this.screen = {
        width: options.resizeTo.clientWidth || 390,
        height: options.resizeTo.clientHeight || 844,
      };
    }
    destroy(): void {}
  }
  return { ...pixi, Application: TestApplication };
});

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const loaded = loadMap(mapJson);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const testMap = loaded.map;

const harness = vi.hoisted(() => ({
  commands: [] as Command[],
  mapCanvas: null as HTMLCanvasElement | null,
  app: null as {
    canvas: HTMLCanvasElement;
    stage: Container;
    ticker: { callbacks: Array<(ticker: { deltaMS: number; FPS: number }) => void> };
    screen: { width: number; height: number };
  } | null,
  world: { x: 100, y: 100 },
  artillery: false,
  focusHex: 0,
  unitHex: 0,
  unitCityLevel: null as number | null,
}));

class TestWorker {
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public postMessage(message: { t: string; map?: unknown; seed?: number; players?: number }): void {
    if ('cmd' in message) {
      harness.commands.push((message as { cmd: Command }).cmd);
      return;
    }
    if (message.t !== 'start') return;
    const engine = createLocalEngine(message.map, message.seed ?? 42, message.players ?? 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const snapshot = engine.snapshot();
    const focusArmy = snapshot.view.armies[0];
    if (!focusArmy) throw new Error('Тестовая армия не создана');
    const focusUnit = snapshot.view.units.find((unit) => unit.armyId === focusArmy.id);
    if (!focusUnit) throw new Error('У тестовой армии нет отрядов');
    harness.focusHex = focusUnit.hex;
    harness.unitHex = snapshot.view.units[0]?.hex ?? 0;
    harness.unitCityLevel =
      snapshot.view.cities.find((city) => city.hex === harness.unitHex)?.level ?? null;
    if (harness.artillery)
      for (const unit of snapshot.view.units) (unit as { type: string }).type = 'artillery';
    if (harness.artillery) {
      (snapshot.view as { units: typeof snapshot.view.units }).units = snapshot.view.units.slice(
        0,
        1,
      );
    }
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          t: 'view',
          kind: 'snapshot',
          snapshot: { t: 'snapshot', tick: snapshot.view.tick, view: snapshot.view },
          seq: 1,
          selection: snapshot.selection,
          rejected: snapshot.rejected,
          events: snapshot.events,
        },
      } as MessageEvent),
    );
  }
  public terminate(): void {}
}

function armyCard(): HTMLElement {
  // Локатор карточки отделяет её от кнопок панели, потому что только карточка имеет _pick_ в классе.
  const card = screen
    .getAllByRole('button')
    .find(
      (item) => item.getAttribute('aria-pressed') === 'false' && item.className.includes('_pick_'),
    );
  if (!card) throw new Error('Карточка армии не отрендерена');
  return card;
}

function selectedArmyCard(): HTMLElement {
  const card = screen
    .getAllByRole('button')
    .find(
      (item) => item.getAttribute('aria-pressed') === 'true' && item.className.includes('_pick_'),
    );
  if (!card) throw new Error('Карточка армии не выбрана');
  return card;
}

async function renderSurface(): Promise<void> {
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(mapJson), { status: 200 })),
  );
  render(createElement(MatchSurface, { debug: true }));
  await waitFor(() => expect(armyCard()).toBeTruthy());
  const app = (globalThis as Record<string, unknown>).__lastTestApplication as typeof harness.app;
  if (!app) throw new Error('Pixi Application не создан');
  app.ticker.callbacks.forEach((callback) => callback({ deltaMS: 0, FPS: 60 }));
  harness.app = app;
  harness.mapCanvas = app.canvas;
  const world = app.stage.children[0];
  if (!(world instanceof Container)) throw new Error('Слой мира MapView не создан');
  const point = hexCenter(hexFromId(harness.unitHex, testMap.width), tokens.map.hexRadius);
  const chipY =
    point.y +
    (harness.unitCityLevel === null
      ? 0
      : cityChipShift(harness.unitCityLevel, tokens.map.hexRadius));
  harness.world = {
    x: world.position.x + point.x * world.scale.x,
    y: world.position.y + chipY * world.scale.y,
  };
}

function screenPointForHex(hexId: number, world: Container): { x: number; y: number } {
  const point = hexCenter(hexFromId(hexId, testMap.width), tokens.map.hexRadius);
  return {
    x: world.position.x + point.x * world.scale.x,
    y: world.position.y + point.y * world.scale.y,
  };
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      public observe(): void {}
      public disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  harness.commands.length = 0;
  harness.mapCanvas = null;
  harness.app = null;
  harness.artillery = false;
  harness.focusHex = 0;
  harness.world = { x: 100, y: 100 };
  harness.unitHex = 0;
  harness.unitCityLevel = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('07/T17bl: удержание и команды матча', () => {
  it('07/T17bke: двойной клик по карточке выбирает армию и центрирует на ней камеру', async () => {
    await renderSurface();
    const card = armyCard();
    expect(card).toBeTruthy();
    expect(card.getAttribute('aria-pressed')).toBe('false');
    fireEvent.doubleClick(card);
    expect(await waitFor(() => selectedArmyCard().getAttribute('aria-pressed'))).toBe('true');

    const app = harness.app;
    if (!app) throw new Error('Pixi Application не создан');
    const world = app.stage.children[0];
    if (!(world instanceof Container)) throw new Error('Слой мира MapView не создан');
    app.ticker.callbacks.forEach((callback) => callback({ deltaMS: tokens.motion.map, FPS: 60 }));
    const target = hexCenter(hexFromId(harness.focusHex, testMap.width), tokens.map.hexRadius);
    const camera = clampCamera(
      {
        scale: world.scale.x,
        x: app.screen.width / 2 - target.x * world.scale.x,
        y: app.screen.height / 2 - target.y * world.scale.y,
      },
      app.screen,
      mapBounds(testMap.width, testMap.height, tokens.map.hexRadius),
    );
    expect({
      x: world.position.x + target.x * world.scale.x,
      y: world.position.y + target.y * world.scale.y,
    }).toEqual({
      x: Math.round(camera.x) + target.x * camera.scale,
      y: Math.round(camera.y) + target.y * camera.scale,
    });
  });

  it('проводит удержание через MatchSurfaceRuntime → map-view и отправляет приказ без секторов', async () => {
    await renderSurface();
    fireEvent.click(armyCard());
    expect(await waitFor(() => selectedArmyCard().getAttribute('aria-pressed'))).toBe('true');
    if (!harness.mapCanvas || !harness.app) throw new Error('MapView input is not connected');
    const world = harness.app.stage.children[0];
    if (!(world instanceof Container)) throw new Error('Слой мира MapView не создан');
    const destination = screenPointForHex(33, world);
    harness.commands.length = 0;
    fireEvent.pointerDown(harness.mapCanvas, {
      button: 0,
      pointerId: 1,
      clientX: harness.world.x,
      clientY: harness.world.y,
    });
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 10));
    harness.app.ticker.callbacks.forEach((callback) => callback({ deltaMS: 0, FPS: 60 }));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.pointerMove(harness.mapCanvas, {
      pointerId: 1,
      clientX: destination.x,
      clientY: destination.y,
    });
    fireEvent.pointerUp(harness.mapCanvas, {
      pointerId: 1,
      clientX: destination.x,
      clientY: destination.y,
    });
    await waitFor(() => expect(harness.commands).toHaveLength(1));
    expect(harness.commands[0]).toEqual({ t: 'move', unitIds: [6, 7], to: 33 });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('проводит двойной тап MapView через runtime до выбора и centerOn', async () => {
    await renderSurface();
    if (!harness.mapCanvas || !harness.app) throw new Error('MapView input is not connected');
    let nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const world = harness.app.stage.children[0];
    if (!(world instanceof Container)) throw new Error('Слой мира MapView не создан');
    fireEvent.wheel(harness.mapCanvas, {
      deltaY: -100,
      clientX: harness.world.x,
      clientY: harness.world.y,
    });
    harness.app.ticker.callbacks.forEach((callback) => callback({ deltaMS: 0, FPS: 60 }));
    const unitCenter = hexCenter(hexFromId(harness.unitHex, testMap.width), tokens.map.hexRadius);
    const tapPoint = {
      x: world.position.x + unitCenter.x * world.scale.x,
      y:
        world.position.y +
        (unitCenter.y +
          (harness.unitCityLevel === null
            ? 0
            : cityChipShift(harness.unitCityLevel, tokens.map.hexRadius))) *
          world.scale.y,
    };
    fireEvent.pointerDown(harness.mapCanvas, {
      button: 0,
      pointerId: 4,
      clientX: tapPoint.x,
      clientY: tapPoint.y,
    });
    fireEvent.pointerUp(harness.mapCanvas, {
      pointerId: 4,
      clientX: tapPoint.x,
      clientY: tapPoint.y,
    });
    const fromScale = world.scale.x;
    await waitFor(() => expect(selectedArmyCard()).toBeTruthy());
    nowMs = 100;
    fireEvent.pointerDown(harness.mapCanvas, {
      button: 0,
      pointerId: 4,
      clientX: tapPoint.x,
      clientY: tapPoint.y,
    });
    fireEvent.pointerUp(harness.mapCanvas, {
      pointerId: 4,
      clientX: tapPoint.x,
      clientY: tapPoint.y,
    });
    harness.app.ticker.callbacks.forEach((callback) =>
      callback({ deltaMS: tokens.motion.map / 2, FPS: 60 }),
    );
    const target = hexCenter(hexFromId(harness.unitHex, testMap.width), tokens.map.hexRadius);
    const expectedCamera = clampCamera(
      {
        scale: fromScale,
        x: harness.app.screen.width / 2 - target.x * fromScale,
        y: harness.app.screen.height / 2 - target.y * fromScale,
      },
      harness.app.screen,
      mapBounds(testMap.width, testMap.height, tokens.map.hexRadius),
    );
    const expectedFinal = {
      x: Math.round(expectedCamera.x) + target.x * expectedCamera.scale,
      y: Math.round(expectedCamera.y) + target.y * expectedCamera.scale,
    };
    expect({
      x: world.position.x + target.x * world.scale.x,
      y: world.position.y + target.y * world.scale.y,
    }).not.toEqual(expectedFinal);
    harness.app.ticker.callbacks.forEach((callback) =>
      callback({ deltaMS: tokens.motion.map / 2, FPS: 60 }),
    );
    expect({
      x: world.position.x + target.x * world.scale.x,
      y: world.position.y + target.y * world.scale.y,
    }).toEqual(expectedFinal);
  });

  it('отправляет ПКМ через MapView без радиальных секторов', async () => {
    await renderSurface();
    const card = armyCard();
    fireEvent.click(card);
    await waitFor(() => expect(selectedArmyCard()).toBeTruthy());
    const world = harness.app?.stage.children[0];
    if (!(world instanceof Container)) throw new Error('Слой мира MapView не создан');
    const destinationHex = 33;
    const point = screenPointForHex(destinationHex, world);
    if (!harness.mapCanvas) throw new Error('MapView input is not connected');
    fireEvent.pointerDown(harness.mapCanvas, {
      button: 2,
      pointerId: 2,
      clientX: point.x,
      clientY: point.y,
    });
    fireEvent.pointerUp(harness.mapCanvas, { pointerId: 2, clientX: point.x, clientY: point.y });
    await waitFor(() => expect(harness.commands).toHaveLength(1));
    expect(harness.commands[0]).toEqual({ t: 'move', unitIds: [6, 7], to: destinationHex });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
