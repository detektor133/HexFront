// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap, type Command } from '@hexfront/sim';

import { sectorAt, type RadialMenuState } from '../src/dev/radial-menu.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { MatchSurface } from '../src/match/MatchSurface.tsx';
import { createGesture, RADIAL_MENU_LONG_PRESS_MS } from '../src/render/gesture.ts';
import { attachInput } from '../src/render/map-view.ts';
import type { createMapView } from '../src/render/map-view.ts';
import { tokens } from '../src/theme/tokens.ts';

type MapViewModule = { createMapView: typeof createMapView };

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const loaded = loadMap(mapJson);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));

const harness = vi.hoisted(() => ({
  commands: [] as Command[],
  onTap: null as
    | ((
        hex: { q: number; r: number },
        kind: 'select' | 'order',
        world: { x: number; y: number },
      ) => void)
    | null,
  onDoubleTap: null as
    ((hex: { q: number; r: number }, world: { x: number; y: number }) => void) | null,
  mapGesture: null as ReturnType<typeof createGesture> | null,
  mapCanvas: null as HTMLCanvasElement | null,
  detachInput: null as (() => void) | null,
  tapHex: { q: 1, r: 1 },
  world: { x: 100, y: 100 },
  centerOn: vi.fn(),
  doubleTaps: 0,
  artillery: false,
}));

vi.mock('../src/render/map-view.ts', async () => {
  const actual = await vi.importActual<MapViewModule>('../src/render/map-view.ts');
  return {
    ...actual,
    createMapView: vi.fn(async (...args: Parameters<typeof actual.createMapView>) => {
      const [, map, options, , onTap, onDoubleTap] = args;
      harness.onTap = onTap ?? null;
      harness.onDoubleTap = onDoubleTap ?? null;
      const layer = options.midLayer?.(map, options.radius);
      const layerWithChipAt = layer as unknown as {
        chipAt?: (id: number) => { x: number; y: number };
      };
      harness.world = layerWithChipAt.chipAt?.(236) ?? { x: 100, y: 100 };
      Object.defineProperty(layer, 'unitsAt', { configurable: true, value: () => [6] });
      return {
        configure: vi.fn(),
        setScale: vi.fn(),
        setBottomInset: vi.fn(),
        setTopInset: vi.fn(),
        setStroke: vi.fn(),
        setSelection: vi.fn(),
        setGrab: vi.fn(),
        setOrderHooks: vi.fn(),
        setRadialHooks: vi.fn(),
        cancel: vi.fn(),
        sceneStats: () => ({
          objects: 0,
          text: 0,
          graphics: 0,
          graphicsInstructions: [],
          graphicsDetails: [],
          textures: 0,
          canvasTextTextures: null,
        }),
        centerOn: harness.centerOn,
        destroy: vi.fn(() => layer?.destroy()),
      } as unknown as Awaited<ReturnType<typeof actual.createMapView>>;
    }),
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
  connectRealMapInput();
}

function menuPoint(item: HTMLElement, menu: HTMLElement): { x: number; y: number } {
  return {
    x: Number.parseFloat(menu.style.left) + Number.parseFloat(item.style.left),
    y: Number.parseFloat(menu.style.top) + Number.parseFloat(item.style.top),
  };
}

function connectRealMapInput(): void {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0 }) });
  Object.defineProperty(canvas, 'setPointerCapture', { value: vi.fn() });
  harness.mapCanvas = canvas;
  harness.mapGesture = createGesture(
    {
      drawing: () => false,
      press: () => undefined,
      release: () => undefined,
      canHold: () => false,
      canRadial: () => false,
      cancelZone: () => false,
      inside: () => true,
    },
    (event) => {
      if (event.t === 'tap') harness.onTap?.(harness.tapHex, event.kind, event.at);
      if (event.t === 'doubleTap') {
        harness.doubleTaps += 1;
        harness.onDoubleTap?.(harness.tapHex, event.at);
      }
    },
  );
  harness.detachInput = attachInput(canvas, harness.mapGesture, {
    zoom: () => undefined,
    pressed: () => undefined,
    idle: () => undefined,
  });
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
  harness.onTap = null;
  harness.onDoubleTap = null;
  harness.mapGesture = null;
  harness.mapCanvas = null;
  harness.detachInput?.();
  harness.detachInput = null;
  harness.tapHex = { q: 1, r: 1 };
  harness.centerOn.mockReset();
  harness.artillery = false;
  harness.doubleTaps = 0;
  harness.world = { x: 100, y: 100 };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it('проводит двойной тап MapView до выделения и анимированного centerOn', async () => {
    await renderSurface();
    if (!harness.mapGesture) throw new Error('MapView не создал жестовую машину');
    const point = harness.world;
    harness.tapHex = hexFromId(236, loaded.map.width);
    connectRealMapInput();
    if (!harness.mapCanvas) throw new Error('MapView input is not connected');
    fireEvent.pointerDown(harness.mapCanvas, {
      button: 0,
      pointerId: 1,
      clientX: point.x,
      clientY: point.y,
    });
    fireEvent.pointerUp(harness.mapCanvas, { pointerId: 1, clientX: point.x, clientY: point.y });
    fireEvent.pointerDown(harness.mapCanvas, {
      button: 0,
      pointerId: 1,
      clientX: point.x,
      clientY: point.y,
    });
    fireEvent.pointerUp(harness.mapCanvas, { pointerId: 1, clientX: point.x, clientY: point.y });
    expect(harness.doubleTaps).toBe(1);
    await waitFor(() =>
      expect(harness.centerOn).toHaveBeenCalledWith(expect.any(Object), tokens.motion.map),
    );
  });

  it('отправляет ПКМ через MapView без открытия radial', async () => {
    await renderSurface();
    if (!harness.mapGesture) throw new Error('MapView не создал жестовую машину');
    const card = armyCard();
    fireEvent.click(card);
    await waitFor(() => expect(selectedArmyCard()).toBeTruthy());
    const point = harness.world;
    harness.tapHex = hexFromId(236, loaded.map.width);
    const unitHex = hexFromId(236, loaded.map.width);
    harness.tapHex = { q: unitHex.q + 1, r: unitHex.r };
    connectRealMapInput();
    if (!harness.mapCanvas) throw new Error('MapView input is not connected');
    fireEvent.pointerDown(harness.mapCanvas, {
      button: 2,
      pointerId: 2,
      clientX: point.x,
      clientY: point.y,
    });
    fireEvent.pointerUp(harness.mapCanvas, { pointerId: 2, clientX: point.x, clientY: point.y });
    await waitFor(() => expect(harness.commands).toHaveLength(1));
    expect(harness.commands[0]).toMatchObject({ t: 'move' });
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
