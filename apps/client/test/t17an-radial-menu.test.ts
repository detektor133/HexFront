// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { Container } from 'pixi.js';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap, type Command } from '@hexfront/sim';

import { cityChipShift } from '../src/dev/chip-place.ts';
import { sectorAt, type RadialMenuState } from '../src/dev/radial-menu.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { MatchSurface } from '../src/match/MatchSurface.tsx';
import { RADIAL_MENU_LONG_PRESS_MS } from '../src/render/gesture.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import type * as MapViewModule from '../src/render/map-view.ts';
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
  } | null,
  world: { x: 100, y: 100 },
  centerOn: vi.fn(),
  artillery: false,
  unitHex: 0,
  unitCityLevel: null as number | null,
}));

vi.mock('../src/render/map-view.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof MapViewModule>();
  return {
    ...actual,
    createMapView: async (...args: Parameters<typeof actual.createMapView>) => {
      const view = await actual.createMapView(...args);
      const centerOn = view.centerOn.bind(view);
      view.centerOn = (hex, durationMs): void => {
        harness.centerOn(hex, durationMs);
        centerOn(hex, durationMs);
      };
      return view;
    },
  };
});

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

function menuPoint(item: HTMLElement, menu: HTMLElement): { x: number; y: number } {
  return {
    x: Number.parseFloat(menu.style.left) + Number.parseFloat(item.style.left),
    y: Number.parseFloat(menu.style.top) + Number.parseFloat(item.style.top),
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
  harness.centerOn.mockReset();
  harness.artillery = false;
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

describe('07/T17an: радиальное меню', () => {
  it('проводит ArmyBar через MatchSurface, useSandbox и send', async () => {
    await renderSurface();
    const card = armyCard();
    fireEvent.click(card);
    const selectedCard = await waitFor(() => {
      const selected = selectedArmyCard();
      expect(selected.getAttribute('aria-pressed')).toBe('true');
      return selected;
    });
    fireEvent.pointerDown(selectedCard, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    const menu = screen.getByRole('menu');
    const merge = screen.getByRole('menuitem', { name: /merge/i });
    const point = menuPoint(merge, menu);
    fireEvent.pointerMove(card, { pointerId: 1, clientX: point.x, clientY: point.y });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: point.x, clientY: point.y });
    expect(harness.commands).toContainEqual({ t: 'merge', unitIds: expect.any(Array) });
  });

  it('отправляет assignUnits после pointerup над дочерним сектором', async () => {
    harness.artillery = true;
    await renderSurface();
    const card = armyCard();
    fireEvent.click(card);
    const selectedCard = await waitFor(() => {
      const selected = selectedArmyCard();
      expect(selected.getAttribute('aria-pressed')).toBe('true');
      return selected;
    });
    fireEvent.pointerDown(selectedCard, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    const menu = screen.getByRole('menu');
    const assign = screen.getByRole('menuitem', { name: /to army/i });
    const root = menuPoint(assign, menu);
    fireEvent.pointerMove(card, { pointerId: 2, clientX: root.x, clientY: root.y });
    const child = screen
      .getAllByRole('menuitem')
      .find((item) => item.getAttribute('aria-label')?.toLowerCase() !== 'reserve');
    if (!child) throw new Error('Дочерний сектор assignUnits не отрендерен');
    const target = menuPoint(child, menu);
    fireEvent.pointerUp(card, { pointerId: 2, clientX: target.x, clientY: target.y });
    expect(harness.commands).toContainEqual({
      t: 'assignUnits',
      unitIds: expect.any(Array),
      armyId: expect.any(Number),
    });
  });

  it('отменяет radial при движении карточки до порога', async () => {
    await renderSurface();
    const card = armyCard();
    fireEvent.pointerDown(card, { button: 0, pointerId: 3, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(card, { pointerId: 3, clientX: 110, clientY: 100 });
    await new Promise((resolve) => setTimeout(resolve, RADIAL_MENU_LONG_PRESS_MS + 10));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(harness.commands).toEqual([]);
  });

  it('проводит удержание фишки MapView через runtime до send', async () => {
    await renderSurface();
    fireEvent.click(armyCard());
    await waitFor(() => expect(selectedArmyCard()).toBeTruthy());
    if (!harness.mapCanvas || !harness.app) throw new Error('MapView input is not connected');
    fireEvent.pointerDown(harness.mapCanvas, {
      button: 0,
      pointerId: 1,
      clientX: harness.world.x,
      clientY: harness.world.y,
    });
    await new Promise((resolve) => setTimeout(resolve, RADIAL_MENU_LONG_PRESS_MS + 10));
    harness.app.ticker.callbacks.forEach((callback) => callback({ deltaMS: 0, FPS: 60 }));
    const menu = await screen.findByRole('menu');
    const merge = screen.getByRole('menuitem', { name: /merge/i });
    const point = menuPoint(merge, menu);
    fireEvent.pointerMove(harness.mapCanvas, {
      pointerId: 1,
      clientX: point.x,
      clientY: point.y,
    });
    fireEvent.pointerUp(harness.mapCanvas, {
      pointerId: 1,
      clientX: point.x,
      clientY: point.y,
    });
    expect(harness.commands).toContainEqual({ t: 'merge', unitIds: expect.any(Array) });
  });

  it('проводит двойной тап MapView через runtime до выбора и centerOn', async () => {
    await renderSurface();
    if (!harness.mapCanvas) throw new Error('MapView input is not connected');
    harness.centerOn.mockReset();
    let nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    fireEvent.pointerDown(harness.mapCanvas, {
      button: 0,
      pointerId: 4,
      clientX: harness.world.x,
      clientY: harness.world.y,
    });
    fireEvent.pointerUp(harness.mapCanvas, {
      pointerId: 4,
      clientX: harness.world.x,
      clientY: harness.world.y,
    });
    await waitFor(() => expect(selectedArmyCard()).toBeTruthy());
    nowMs = 100;
    fireEvent.pointerDown(harness.mapCanvas, {
      button: 0,
      pointerId: 4,
      clientX: harness.world.x,
      clientY: harness.world.y,
    });
    fireEvent.pointerUp(harness.mapCanvas, {
      pointerId: 4,
      clientX: harness.world.x,
      clientY: harness.world.y,
    });
    expect(harness.centerOn).toHaveBeenCalledWith(
      hexFromId(harness.unitHex, testMap.width),
      tokens.motion.map,
    );
  });

  it('отправляет ПКМ через MapView без открытия radial', async () => {
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

  it('не выбирает центр radial', () => {
    const state: RadialMenuState = {
      center: { x: 100, y: 100 },
      actions: [{ kind: 'merge', label: 'merge' }],
      active: [{ kind: 'merge', label: 'merge' }],
    };
    expect(sectorAt(state, { x: 100, y: 100 })).toBeNull();
  });

  it('проверяет точный корневой набор artillery и payload bombard', async () => {
    harness.artillery = true;
    await renderSurface();
    const card = armyCard();
    fireEvent.click(card);
    const selectedCard = await waitFor(() => selectedArmyCard());
    fireEvent.pointerDown(selectedCard, { button: 0, pointerId: 6, clientX: 100, clientY: 100 });
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(
      expect.arrayContaining(['To army', 'Auto fire']),
    );
    expect(screen.queryByRole('menuitem', { name: /merge/i })).toBeNull();
    const bombard = screen.getByRole('menuitem', { name: 'Auto fire' });
    const point = menuPoint(bombard, menu);
    fireEvent.pointerMove(selectedCard, { pointerId: 6, clientX: point.x, clientY: point.y });
    fireEvent.pointerUp(selectedCard, { pointerId: 6, clientX: point.x, clientY: point.y });
    expect(harness.commands).toContainEqual({
      t: 'bombard',
      unitId: expect.any(Number),
      targetUnitId: null,
    });
  });

  it('отменяет radial при отпускании вне секторов без send', async () => {
    await renderSurface();
    const card = armyCard();
    fireEvent.click(card);
    const selectedCard = await waitFor(() => selectedArmyCard());
    fireEvent.pointerDown(selectedCard, { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    fireEvent.pointerUp(selectedCard, { pointerId: 7, clientX: 100, clientY: 100 });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(harness.commands).toEqual([]);
  });
});
