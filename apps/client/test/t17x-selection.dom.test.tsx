import { readFileSync } from 'node:fs';

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, hexId, loadMap, neighbors, type MapStatic } from '@hexfront/sim';

import type * as SandboxSelection from '../src/dev/sandbox-selection.ts';
import { formatSoldiers } from '../src/i18n/format.ts';
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
): { view: MapView; gesture: Gesture; panCount: () => number; selectionPhases: () => string[] } {
  let selection:
    ((from: Point, to: Point, phase: 'start' | 'move' | 'end' | 'cancel') => void) | null = null;
  let pans = 0;
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
          selection(event.at, event.to, event.phase);
        }
      }
      if (event.t === 'pan') pans += 1;
    },
  );
  void map;
  return {
    view,
    gesture,
    panCount: () => pans,
    selectionPhases: () => selectionPhases,
  };
}

describe('07/T17x: выбор через реальный путь /match', () => {
  it('клик по текущей позиции движущейся фишки вызывает onTap и выбирает отряд', async () => {
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
      units: source.view.units.map((unit) =>
        unit.id === moving.id
          ? {
              ...unit,
              armyId: null,
              soldiers: 123_000 as typeof unit.soldiers,
              path: [hexId(next, loaded.map.width)],
              moveTicks: 9,
              moveTotal: 10,
            }
          : unit,
      ),
    };
    const message: FromWorker = {
      ...source,
      view,
      snapshot: { ...source.snapshot, view },
    };
    let tap: TapHandler | undefined;
    let mapStub: ReturnType<typeof mapViewStub> | undefined;
    const selectUnitsSpy = vi.fn();
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
      selectUnitsSpy.mockImplementation(actual.selectUnits);
      return { ...actual, selectUnits: selectUnitsSpy };
    });
    vi.doMock('../src/render/map-view.ts', () => ({
      createMapView: async (
        _host: HTMLElement,
        map: MapStatic,
        options: MapViewOptions,
        _state: unknown,
        handler: TapHandler,
      ) => {
        options.midLayer?.(map, options.radius);
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
    act(() => mapStub?.gesture.down(1, current, 0, 0));
    act(() => mapStub?.gesture.up(1, current, 1));
    await waitFor(() => expect(selectUnitsSpy).toHaveBeenCalled());
    expect(selectUnitsSpy.mock.calls.at(-1)?.[2]).toEqual([moving.id]);
  });

  it('Shift-протяжка проходит через setSelection, а протяжка без Shift только панорамирует', async () => {
    installDomGlobals();
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const source = engine.snapshot();
    const own = source.view.units.filter((unit) => unit.owner === source.view.playerId).slice(0, 2);
    if (own.length !== 2) throw new Error('нужны два своих отряда');
    const selectedUnits = own.map((unit, index) => ({
      ...unit,
      armyId: null,
      soldiers: (index === 0 ? 111_000 : 222_000) as typeof unit.soldiers,
    }));
    const message: FromWorker = {
      ...source,
      view: { ...source.view, units: selectedUnits },
      snapshot: { ...source.snapshot, view: { ...source.view, units: selectedUnits } },
    };
    let mapStub: ReturnType<typeof mapViewStub> | undefined;
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
        options.midLayer?.(map, options.radius);
        mapStub = mapViewStub(map, handler as never);
        return mapStub.view;
      },
    }));
    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    render(<MatchPage />);
    await waitFor(() => expect(mapStub).toBeDefined());
    const points = own.map((unit) =>
      hexCenter(hexFromId(unit.hex, loaded.map.width), tokens.map.hexRadius),
    );
    const first = {
      x: Math.min(...points.map((point) => point.x)) - 4,
      y: Math.min(...points.map((point) => point.y)) - 4,
    };
    const second = {
      x: Math.max(...points.map((point) => point.x)) + 4,
      y: Math.max(...points.map((point) => point.y)) + 4,
    };
    act(() => mapStub?.gesture.down(1, first, 0, 0, true));
    act(() => mapStub?.gesture.move(1, second, 20));
    act(() => mapStub?.gesture.up(1, second, 40));
    act(() => mapStub?.gesture.down(2, first, 0, 0));
    act(() => mapStub?.gesture.move(2, second, 20));
    act(() => mapStub?.gesture.up(2, second, 40));
    expect(mapStub?.selectionPhases()).toEqual(['start', 'move', 'end']);
    const selectedCard = (): Element | null =>
      document.querySelector('section[aria-label^="Выбрано"]');
    await waitFor(() => expect(selectedCard()).toBeDefined());
    const selectedLabel = selectedCard()?.getAttribute('aria-label');
    expect(selectedLabel).toBeTruthy();
    expect(selectedLabel).toContain('Выбрано отрядов: 2');
    expect(selectedLabel).toContain(formatSoldiers(333_000));
    expect(mapStub?.panCount()).toBe(1);
  });
});
