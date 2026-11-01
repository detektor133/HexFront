// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, hexId, loadMap, neighbors, type MapStatic } from '@hexfront/sim';

import { cityChipShift } from '../src/dev/chip-place.ts';
import { createEconomyLayer, type EconomyLayer } from '../src/dev/economy-layer.ts';
import type * as SandboxSelection from '../src/dev/sandbox-selection.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import type { LocalMatch } from '../src/local/local-match.ts';
import type { FromWorker } from '../src/local/messages.ts';
import { createGesture, type Gesture } from '../src/render/gesture.ts';
import { hexCenter, pixelToHex, type Point } from '../src/render/hex-geometry.ts';
import type { MapView, MapViewOptions, TapKind } from '../src/render/map-view.ts';
import { tokens } from '../src/theme/tokens.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(mapJson);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
type TapHandler = (hex: { q: number; r: number }, kind: TapKind, world: Point) => void;

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/match');
});

function installDomGlobals(): void {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
}

function mapViewStub(
  map: MapStatic,
  onTap: (hex: { q: number; r: number }, kind: TapKind, world: Point) => void,
): {
  view: MapView;
  gesture: Gesture;
  panCount: () => number;
  zoomCount: () => number;
  selectionPhases: () => string[];
  selectRect: (from: Point, to: Point) => void;
} {
  const camera = { x: 170, y: 90, scale: 1.5 };
  const toWorld = (point: Point): Point => ({
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  });
  let selection:
    ((from: Point, to: Point, phase: 'start' | 'move' | 'end' | 'cancel') => void) | null = null;
  let pans = 0;
  let zooms = 0;
  const selectionPhases: string[] = [];
  const view = {
    configure: () => undefined,
    setScale: () => undefined,
    setBottomInset: () => undefined,
    setTopInset: () => undefined,
    centerOn: () => undefined,
    setStroke: () => undefined,
    setSelection: (handler: typeof selection) => {
      selection = handler;
    },
    setGrab: () => undefined,
    setOrderHooks: () => undefined,
    cancel: () => undefined,
    sceneStats: () => ({
      objects: 0,
      text: 0,
      graphics: 0,
      graphicsInstructions: [],
      graphicsDetails: [],
      textures: 0,
      canvasTextTextures: null,
    }),
    destroy: () => undefined,
  } as MapView;
  const gesture = createGesture(
    {
      drawing: () => false,
      press: () => undefined,
      release: () => undefined,
      canHold: () => false,
      cancelZone: () => false,
      inside: () => true,
    },
    (event) => {
      if (event.t === 'tap') {
        onTap(pixelToHex(event.at, tokens.map.hexRadius), event.kind, event.at);
      }
      if (event.t === 'selection') {
        if (selection) {
          selectionPhases.push(event.phase);
          selection(toWorld(event.at), toWorld(event.to), event.phase);
        }
      }
      if (event.t === 'pan') pans += 1;
      if (event.t === 'zoom') zooms += 1;
    },
  );
  void map;
  return {
    view,
    gesture,
    panCount: () => pans,
    zoomCount: () => zooms,
    selectionPhases: () => selectionPhases,
    selectRect: (from, to) => selection?.(from, to, 'end'),
  };
}

describe('07/T17x: выбор через реальный путь /match', () => {
  it('рамка выбирает видимую фишку в sandbox runtime', async () => {
    installDomGlobals();
    window.history.replaceState({}, '', '/dev/sandbox?map=tiny&debug=1');
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const source = engine.snapshot();
    const sourceUnit = source.view.units.find((unit) => unit.owner === source.view.playerId);
    if (!sourceUnit) throw new Error('в sandbox не подготовлен собственный отряд');
    const target = neighbors(hexFromId(sourceUnit.hex, loaded.map.width))[0];
    if (!target) throw new Error('для бронетехники не подготовлена цель атаки');
    const armor = {
      ...sourceUnit,
      type: 'armor' as const,
      order: 'attack' as const,
      target: hexId(target, loaded.map.width),
    };
    const units = source.view.units.map((unit) => (unit.id === armor.id ? armor : unit));
    const view = { ...source.view, units };
    const message: FromWorker = {
      ...source,
      view,
      snapshot: { ...source.snapshot, view },
    };
    let mapStub: ReturnType<typeof mapViewStub> | undefined;
    let chipBounds:
      | ((unitId: number) => { left: number; right: number; top: number; bottom: number } | null)
      | undefined;
    const selected = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => mapJson }) as Response),
    );
    vi.doMock('../src/local/local-match.ts', () => ({
      startLocalMatch: (
        _map: unknown,
        _seed: number,
        _setup: unknown,
        emit: (m: FromWorker) => void,
      ): LocalMatch => {
        emit(message);
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
      },
    }));
    vi.doMock('../src/render/map-view.ts', () => ({
      createMapView: async (
        _host: HTMLElement,
        map: MapStatic,
        options: MapViewOptions,
        _state: unknown,
        handler: TapHandler,
      ) => {
        const layer = options.midLayer?.(map, options.radius) as
          { readonly chipBounds?: typeof chipBounds } | undefined;
        chipBounds = layer?.chipBounds;
        mapStub = mapViewStub(map, handler);
        return mapStub.view;
      },
    }));
    vi.doMock('../src/dev/sandbox-selection.ts', async () => {
      const actual = await vi.importActual<typeof SandboxSelection>(
        '../src/dev/sandbox-selection.ts',
      );
      return {
        ...actual,
        selectUnitsInRect: vi.fn((...args: Parameters<typeof actual.selectUnitsInRect>) => {
          const result = actual.selectUnitsInRect(...args);
          selected(result);
          return result;
        }),
      };
    });
    const { DevSandboxPage } = await import('../src/dev/DevSandboxPage.tsx');
    render(<DevSandboxPage />);
    await waitFor(() => expect(mapStub).toBeDefined());
    const own = message.view.units.find((unit) => unit.id === armor.id);
    if (!own) throw new Error('в sandbox не подготовлена бронетехника');
    const bounds = chipBounds?.(own.id);
    if (!bounds) throw new Error('в sandbox не подготовлена видимая фишка');
    const center = hexCenter(hexFromId(own.hex, loaded.map.width), tokens.map.hexRadius);
    expect(bounds.right).toBeGreaterThan(center.x + tokens.map.hexRadius);
    act(() =>
      mapStub?.selectRect(
        { x: center.x + tokens.map.hexRadius, y: bounds.top },
        { x: bounds.right, y: bounds.bottom },
      ),
    );
    await waitFor(() => expect(selected).toHaveBeenCalledWith([own.id]));
    act(() =>
      mapStub?.selectRect(
        { x: bounds.right, y: bounds.top },
        { x: bounds.right + 1, y: bounds.bottom },
      ),
    );
    await waitFor(() => expect(selected).toHaveBeenLastCalledWith([]));
  });

  it('рамка выбирает движущуюся фишку по интерполированной позиции', async () => {
    installDomGlobals();
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const source = engine.snapshot();
    const moving = source.view.units.find((unit) => unit.owner === source.view.playerId);
    if (!moving) throw new Error('свой отряд не найден');
    const next = neighbors(hexFromId(moving.hex, loaded.map.width))[0];
    if (!next) throw new Error('соседний гекс не найден');
    const view = {
      ...source.view,
      units: [
        {
          ...moving,
          armyId: null,
          soldiers: 123_000 as typeof moving.soldiers,
          path: [hexId(next, loaded.map.width)],
          moveTicks: 9,
          moveTotal: 10,
        },
      ],
    };
    const message: FromWorker = {
      ...source,
      view,
      snapshot: { ...source.snapshot, view },
    };
    let tap: TapHandler | undefined;
    let mapStub: ReturnType<typeof mapViewStub> | undefined;
    let chipBounds:
      | ((unitId: number) => { left: number; right: number; top: number; bottom: number } | null)
      | undefined;
    const selectedByFrame = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => mapJson }) as Response),
    );
    vi.doMock('../src/local/local-match.ts', () => ({
      startLocalMatch: (
        _map: unknown,
        _seed: number,
        _setup: unknown,
        emit: (m: FromWorker) => void,
      ): LocalMatch => {
        emit(message);
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
      },
    }));
    vi.doMock('../src/dev/sandbox-selection.ts', async () => {
      const actual = await vi.importActual<typeof SandboxSelection>(
        '../src/dev/sandbox-selection.ts',
      );
      return {
        ...actual,
        selectUnitsInRect: vi.fn((...args: Parameters<typeof actual.selectUnitsInRect>) => {
          const result = actual.selectUnitsInRect(...args);
          selectedByFrame(result);
          return result;
        }),
      };
    });
    vi.doMock('../src/render/map-view.ts', () => ({
      createMapView: async (
        _host: HTMLElement,
        map: MapStatic,
        options: MapViewOptions,
        _state: unknown,
        handler: TapHandler,
      ) => {
        const layer = options.midLayer?.(map, options.radius) as
          { readonly chipBounds?: typeof chipBounds } | undefined;
        chipBounds = layer?.chipBounds;
        tap = handler;
        mapStub = mapViewStub(map, handler);
        return mapStub.view;
      },
    }));
    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    render(<MatchPage />);
    await waitFor(() => expect(tap).toBeDefined());
    const start = hexCenter(hexFromId(moving.hex, loaded.map.width), tokens.map.hexRadius);
    const finish = hexCenter(next, tokens.map.hexRadius);
    const current = {
      x: start.x + (finish.x - start.x) * 0.9,
      y: start.y + (finish.y - start.y) * 0.9,
    };
    const bounds = chipBounds?.(moving.id);
    if (!bounds) throw new Error('границы движущейся фишки не подготовлены');
    const chipCenter = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
    expect(Math.hypot(chipCenter.x - current.x, chipCenter.y - current.y)).toBeLessThan(3);
    const frameFrom = { x: chipCenter.x - 1, y: chipCenter.y - 1 };
    const frameTo = { x: chipCenter.x + 1, y: chipCenter.y + 1 };
    act(() => mapStub?.selectRect(frameFrom, frameTo));
    await waitFor(() => expect(selectedByFrame).toHaveBeenCalledWith([moving.id]));
  });

  it('ЛКМ-протяжка без Shift выбирает отряды, двухпальцевый жест панорамирует', async () => {
    installDomGlobals();
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const source = engine.snapshot();
    const own = source.view.units.filter((unit) => unit.owner === source.view.playerId).slice(0, 2);
    if (own.length !== 2) throw new Error('нужны два исходных своих отряда');
    const selectedUnits = own.map((unit, index) => ({
      ...unit,
      hex: source.view.cities.find((city) => city.owner === source.view.playerId)?.hex ?? unit.hex,
      armyId: null,
      soldiers: (index === 0 ? 111_000 : 222_000) as typeof unit.soldiers,
    }));
    const enemy = source.view.units.find((unit) => unit.owner !== source.view.playerId);
    if (!enemy) throw new Error('нужен чужой отряд');
    const template = selectedUnits[0];
    if (!template) throw new Error('нужен отряд для проверки исключений');
    selectedUnits.push(
      {
        ...template,
        id: template.id + 300_000,
        type: 'armor',
        soldiers: 333_000 as typeof template.soldiers,
      },
      {
        ...template,
        id: template.id + 100_000,
        owner: enemy.owner,
        soldiers: 555_000 as typeof template.soldiers,
      },
      {
        ...template,
        id: template.id + 200_000,
        order: 'retreat',
        soldiers: 444_000 as typeof template.soldiers,
      },
    );
    const message: FromWorker = {
      ...source,
      view: { ...source.view, units: selectedUnits },
      snapshot: { ...source.snapshot, view: { ...source.view, units: selectedUnits } },
    };
    let mapStub: ReturnType<typeof mapViewStub> | undefined;
    let chipBounds:
      | ((unitId: number) => { left: number; right: number; top: number; bottom: number } | null)
      | undefined;
    let comparisonLayer: EconomyLayer | undefined;
    const selectedByFrame = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => mapJson }) as Response),
    );
    vi.doMock('../src/local/local-match.ts', () => ({
      startLocalMatch: (
        _map: unknown,
        _seed: number,
        _setup: unknown,
        emit: (m: FromWorker) => void,
      ): LocalMatch => {
        emit(message);
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
      },
    }));
    vi.doMock('../src/render/map-view.ts', () => ({
      createMapView: async (
        _host: HTMLElement,
        map: MapStatic,
        options: MapViewOptions,
        _state: unknown,
        handler: TapHandler,
      ) => {
        const layer = options.midLayer?.(map, options.radius) as EconomyLayer | undefined;
        comparisonLayer = createEconomyLayer(map, options.radius);
        chipBounds = layer?.chipBounds;
        mapStub = mapViewStub(map, handler as never);
        return mapStub.view;
      },
    }));
    vi.doMock('../src/dev/sandbox-selection.ts', async () => {
      const actual = await vi.importActual<typeof SandboxSelection>(
        '../src/dev/sandbox-selection.ts',
      );
      return {
        ...actual,
        selectUnitsInRect: vi.fn((...args: Parameters<typeof actual.selectUnitsInRect>) => {
          const result = actual.selectUnitsInRect(...args);
          selectedByFrame(result);
          return result;
        }),
      };
    });
    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    render(<MatchPage />);
    await waitFor(() => expect(mapStub).toBeDefined());
    const camera = { x: 170, y: 90, scale: 1.5 };
    const toScreen = (point: Point): Point => ({
      x: camera.x + point.x * camera.scale,
      y: camera.y + point.y * camera.scale,
    });
    const bounds = selectedUnits
      .filter((unit) => unit.owner === source.view.playerId && unit.order !== 'retreat')
      .map((unit) => chipBounds?.(unit.id));
    if (bounds.some((item) => item === null || item === undefined))
      throw new Error('границы видимых фишек не подготовлены');
    const visibleBounds = bounds.filter(
      (item): item is NonNullable<typeof item> => item !== null && item !== undefined,
    );
    if (visibleBounds.length !== bounds.length) throw new Error('границы фишек неполные');
    const armor = selectedUnits[2];
    if (!armor) throw new Error('бронетехника не подготовлена');
    const armorBounds = chipBounds?.(armor.id);
    if (!armorBounds) throw new Error('границы фишки бронетехники не подготовлены');
    const city = source.view.cities.find((item) => item.owner === source.view.playerId);
    if (!city) throw new Error('свой город не подготовлен');
    const matchView = message.snapshot.view;
    const withoutCity = {
      ...matchView,
      cities: matchView.cities.filter((item) => item.id !== city.id),
    };
    if (!comparisonLayer) throw new Error('сравнительный слой не подготовлен');
    comparisonLayer.setView(withoutCity, { units: [], hex: null, target: null });
    comparisonLayer.frame(110_000);
    const armorBoundsWithoutCity = comparisonLayer.chipBounds(armor.id);
    if (!armorBoundsWithoutCity) throw new Error('границы фишки без города не подготовлены');
    const cityShift = cityChipShift(city.level, tokens.map.hexRadius);
    expect(armorBounds.left).toBe(armorBoundsWithoutCity.left);
    expect(armorBounds.right).toBe(armorBoundsWithoutCity.right);
    expect(armorBounds.top - armorBoundsWithoutCity.top).toBeCloseTo(cityShift, 3);
    expect(armorBounds.bottom - armorBoundsWithoutCity.bottom).toBeCloseTo(cityShift, 3);
    act(() =>
      mapStub?.selectRect(
        { x: armorBounds.left, y: armorBounds.top },
        { x: armorBounds.right, y: armorBounds.bottom },
      ),
    );
    await waitFor(() => expect(selectedByFrame).toHaveBeenCalledWith([armor.id]));
    const left = Math.min(...visibleBounds.map((item) => item.left));
    const top = Math.min(...visibleBounds.map((item) => item.top));
    const right = Math.max(...visibleBounds.map((item) => item.right));
    const bottom = Math.max(...visibleBounds.map((item) => item.bottom));
    const first = {
      x: toScreen({ x: left, y: top }).x - 1,
      y: toScreen({ x: left, y: top }).y - 1,
    };
    const second = {
      x: toScreen({ x: right, y: bottom }).x + 1,
      y: toScreen({ x: right, y: bottom }).y + 1,
    };
    act(() => mapStub?.gesture.down(1, first, 0, 0));
    act(() => mapStub?.gesture.move(1, second, 20));
    act(() => mapStub?.gesture.up(1, second, 40));
    expect(mapStub?.panCount()).toBe(0);
    const secondFinger = { x: first.x + 30, y: first.y };
    act(() => mapStub?.gesture.down(1, first, 0, 50, false, false));
    act(() => mapStub?.gesture.down(2, secondFinger, 0, 50, false, false));
    act(() => mapStub?.gesture.move(2, { x: secondFinger.x + 10, y: secondFinger.y }, 70));
    act(() => mapStub?.gesture.up(1, first, 80));
    act(() => mapStub?.gesture.up(2, { x: secondFinger.x + 10, y: secondFinger.y }, 80));
    expect(mapStub?.selectionPhases()).toEqual(['start', 'move', 'end']);
    const selectedCard = await screen.findByRole('region', { name: 'Выбранные отряды' });
    expect(selectedCard.textContent).not.toContain('Выбрано отрядов');
    expect(selectedCard.querySelectorAll('li')).toHaveLength(4);
    const selectedRows = Array.from(
      selectedCard.querySelectorAll('li button[aria-pressed="true"]'),
    );
    expect(selectedRows).toHaveLength(3);
    expect(selectedRows.map((row) => row.textContent)).toEqual(
      expect.arrayContaining(['Пехота · 111', 'Пехота · 222', 'Бронетехника · 333']),
    );
    expect(selectedCard.textContent).not.toContain('555');
    expect(selectedCard.textContent).toContain('444');
    expect(mapStub?.panCount()).toBe(1);
    expect(mapStub?.zoomCount()).toBe(1);
  });
});
