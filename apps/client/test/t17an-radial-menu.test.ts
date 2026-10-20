// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap, type PlayerView, type UnitView } from '@hexfront/sim';

import { ArmyBar } from '../src/dev/ArmyBar.tsx';
import { sectorAt, sectorCenter, type RadialMenuState } from '../src/dev/radial-menu.ts';
import type { Picked } from '../src/dev/sandbox-selection.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import {
  createDoubleTapHandler,
  createOrderHandler,
  createRadialActionHandler,
} from '../src/match/MatchSurfaceRuntime.tsx';
import { RADIAL_MENU_LONG_PRESS_MS, createGesture } from '../src/render/gesture.ts';
import { tokens } from '../src/theme/tokens.ts';

const unit = {
  id: 10,
  owner: 0,
  armyId: 1,
  hex: 4,
  type: 'infantry',
  soldiers: 10,
  org: 1000,
  supplyLevel: 1000,
  encircled: false,
} as unknown as UnitView;
const view = {
  playerId: 0,
  units: [unit, { ...unit, id: 11 }],
  armies: [
    { id: 1, number: 1, name: '', auto: false },
    { id: 2, number: 2, name: '', auto: false },
  ],
  cities: [],
  plans: [],
  me: { autoReinforce: false },
} as unknown as PlayerView;
const surfaceMapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const surfaceMap = loadMap(surfaceMapJson);
if (!surfaceMap.ok) throw new Error(surfaceMap.errors.join('; '));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
  configurable: true,
  value: vi.fn(),
});

function renderArmy(
  viewToRender: PlayerView,
  radial: (
    armyId: number,
    point: { readonly x: number; readonly y: number },
    phase: 'start' | 'move' | 'end' | 'cancel',
  ) => void,
): HTMLElement {
  render(
    createElement(ArmyBar, {
      view: viewToRender,
      selected: null,
      partial: [],
      onSelect: () => undefined,
      send: () => undefined,
      onPick: () => undefined,
      tool: null,
      onTool: () => undefined,
      onRadial: radial,
    }),
  );
  const card = screen
    .getAllByRole('button')
    .find((item) => item.getAttribute('aria-pressed') === 'false');
  if (!card) throw new Error('карточка армии не отрендерена');
  return card;
}

describe('07/T17an: радиальное меню', () => {
  it('проводит удержание ArmyBar через MatchSurface в runtime send', async () => {
    const engine = createLocalEngine(surfaceMapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const runtimeSend = vi.fn();
    let radialState: RadialMenuState | null = null;
    vi.doMock('../src/match/MatchSurfaceRuntime.tsx', async () => {
      const actual = (await vi.importActual('../src/match/MatchSurfaceRuntime.tsx')) as {
        readonly createRadialActionHandler: typeof createRadialActionHandler;
      };
      const radialForArmy = actual.createRadialActionHandler({
        getView: () => engine.snapshot().view,
        send: runtimeSend,
        getState: () => radialState,
        setState: (next: RadialMenuState | null) => {
          radialState = next;
        },
      });
      return {
        ...actual,
        useMapJson: () => ({ json: surfaceMapJson, map: surfaceMap.map }),
        useSandbox: () => ({
          msg: engine.snapshot(),
          replay: [],
          error: null,
          picked: { hex: null, units: [], target: null },
          lastReject: null,
          tool: null,
          army: null,
          fog: false,
          paused: false,
          speed: 1,
          observerId: null,
          events: [],
          workerTelemetry: null,
          snapshotTelemetry: () => ({ received: 0, collected: 0, live: 0 }),
          cacheTelemetry: () => ({
            unit: { shown: 0, drawnAt: 0, chips: 0, encircledSince: 0 },
            economy: { capturesByHex: 0, cityFlashes: 0 },
            frontTween: { byArmy: 0 },
          }),
          focusEvent: vi.fn(),
          send: runtimeSend,
          setFog: vi.fn(),
          setPaused: vi.fn(),
          step: vi.fn(),
          setSpeed: vi.fn(),
          setObserver: vi.fn(),
          pick: vi.fn(),
          setTool: vi.fn(),
          setArmy: vi.fn(),
          setRoadPreview: vi.fn(),
          setDockHeight: vi.fn(),
          setHudHeight: vi.fn(),
          pixiTelemetry: () => ({
            objects: 0,
            text: 0,
            graphics: 0,
            graphicsInstructions: [],
            graphicsDetails: [],
            textures: 0,
            canvasTextTextures: null,
          }),
          radial: radialState,
          radialForArmy,
        }),
      };
    });
    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
      },
    );
    render(createElement(MatchSurface));
    const card = screen
      .getAllByRole('button')
      .find((item) => item.getAttribute('aria-pressed') === 'false');
    if (!card) throw new Error('карточка армии не отрендерена через MatchSurface');
    vi.useFakeTimers();
    fireEvent.pointerDown(card, { button: 0, pointerId: 3, clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(RADIAL_MENU_LONG_PRESS_MS);
    if (!radialState) throw new Error('runtime radial не открыт');
    fireEvent.pointerUp(card, {
      pointerId: 3,
      clientX: sectorCenter(radialState, 0).x,
      clientY: sectorCenter(radialState, 0).y,
    });
    expect(runtimeSend).toHaveBeenCalledWith({ t: 'merge', unitIds: [6, 7] });
  });

  it('открывает radial после 400 мс и не меняет удержание 350 мс', () => {
    const events: string[] = [];
    const gesture = createGesture(
      {
        drawing: () => false,
        press: () => undefined,
        release: () => undefined,
        canHold: () => true,
        canRadial: () => true,
        cancelZone: () => false,
        inside: () => true,
      },
      (event) => events.push(event.t),
    );
    gesture.down(1, { x: 100, y: 100 }, 0, 0);
    gesture.tick(350);
    expect(events).toEqual([]);
    gesture.tick(RADIAL_MENU_LONG_PRESS_MS);
    expect(events).toEqual(['radial']);
  });

  it('проводит удержание ArmyBar через runtime до send для merge и bombard', () => {
    const sent: unknown[] = [];
    let state: RadialMenuState | null = null;
    const radial = createRadialActionHandler({
      getView: () => view,
      send: (command) => sent.push(command),
      getState: () => state,
      setState: (next) => {
        state = next;
      },
    });
    vi.useFakeTimers();
    const card = renderArmy(view, radial);
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(RADIAL_MENU_LONG_PRESS_MS);
    expect((state as RadialMenuState | null)?.center).toEqual({ x: 100, y: 100 });
    if (!state) throw new Error('radial не открыт');
    const merge = sectorCenter(state, 0);
    fireEvent.pointerUp(card, { pointerId: 1, clientX: merge.x, clientY: merge.y });
    expect(sent).toEqual([{ t: 'merge', unitIds: [10, 11] }]);
    expect(state).toBeNull();

    const outsideState: RadialMenuState = {
      center: { x: 100, y: 100 },
      actions: [{ kind: 'merge', label: 'merge', command: { t: 'merge', unitIds: [10, 11] } }],
      active: [{ kind: 'merge', label: 'merge', command: { t: 'merge', unitIds: [10, 11] } }],
    };
    state = outsideState;
    const sentBeforeCancel = sent.length;
    radial(1, { x: 100, y: 100 }, 'end');
    expect(sent).toHaveLength(sentBeforeCancel);
    expect(state).toBeNull();

    cleanup();
    state = null;
    const artillery = { ...unit, id: 12, type: 'artillery' as const };
    const artilleryView = { ...view, units: [artillery] } as unknown as PlayerView;
    const artilleryRadial = createRadialActionHandler({
      getView: () => artilleryView,
      send: (command) => sent.push(command),
      getState: () => state,
      setState: (next) => {
        state = next;
      },
    });
    const artilleryCard = renderArmy(artilleryView, artilleryRadial);
    fireEvent.pointerDown(artilleryCard, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(RADIAL_MENU_LONG_PRESS_MS);
    const artilleryState = state as RadialMenuState | null;
    if (artilleryState === null) throw new Error('radial артиллерии не открыт');
    expect(artilleryState.actions.map((action) => action.kind)).toEqual(['assignUnits', 'bombard']);
    expect(artilleryState.actions[0]?.children?.map((action) => action.command)).toEqual([
      { t: 'assignUnits', unitIds: [12], armyId: 1 },
      { t: 'assignUnits', unitIds: [12], armyId: 2 },
      { t: 'assignUnits', unitIds: [12], armyId: null },
    ]);
    const bombard = sectorCenter(artilleryState, 1);
    fireEvent.pointerUp(artilleryCard, { pointerId: 2, clientX: bombard.x, clientY: bombard.y });
    expect(sent.at(-1)).toEqual({ t: 'bombard', unitId: 12, targetUnitId: null });
  });

  it('отменяет удержание карточки при смещении больше DRAG_SLOP_PX', () => {
    let state: RadialMenuState | null = null;
    const radial = createRadialActionHandler({
      getView: () => view,
      send: () => undefined,
      getState: () => state,
      setState: (next) => {
        state = next;
      },
    });
    vi.useFakeTimers();
    const card = renderArmy(view, radial);
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 109, clientY: 100 });
    vi.advanceTimersByTime(RADIAL_MENU_LONG_PRESS_MS);
    expect(state).toBeNull();
  });

  it('передаёт doubleTap из createGesture в callback MapView с анимацией 250 мс', () => {
    const calls: unknown[] = [];
    const events: string[] = [];
    const onMapDoubleTap = createDoubleTapHandler({
      getView: () => view,
      map: { width: 3, height: 3 } as never,
      getPicked: () => ({ hex: null, units: [], target: null }),
      getHit: () => [10],
      pick: (picked) => calls.push(picked),
      centerOn: (hex, duration) => calls.push({ hex, duration }),
    });
    const gesture = createGesture(
      {
        drawing: () => false,
        press: () => undefined,
        release: () => undefined,
        canHold: () => true,
        canRadial: () => false,
        cancelZone: () => false,
        inside: () => true,
      },
      (event) => {
        events.push(event.t);
        if (event.t === 'doubleTap') onMapDoubleTap({ q: 1, r: 1 }, event.at);
      },
    );
    gesture.down(1, { x: 1, y: 1 }, 0, 0);
    gesture.up(1, { x: 1, y: 1 }, 0);
    gesture.down(1, { x: 1, y: 1 }, 0, 100);
    gesture.up(1, { x: 1, y: 1 }, 200);
    expect(events).toEqual(['tap', 'doubleTap']);
    expect(calls[0]).toEqual({ hex: null, units: [10], target: null });
    expect(calls[1]).toEqual({ hex: hexFromId(4, 3), duration: tokens.motion.map });
    expect(tokens.motion.map).toBe(250);
  });

  it('отправляет payload приказа через send на ПКМ без radial-состояния', () => {
    const sent: unknown[] = [];
    const picked: Picked = { hex: null, units: [10], target: null };
    const order = createOrderHandler({
      getView: () => view,
      getPicked: () => picked,
      send: (command) => sent.push(command),
      pick: () => undefined,
    });
    const gesture = createGesture(
      {
        drawing: () => false,
        press: () => undefined,
        release: () => undefined,
        canHold: () => true,
        canRadial: () => true,
        cancelZone: () => false,
        inside: () => true,
      },
      (event) => {
        if (event.t !== 'tap' || event.kind !== 'order') return;
        order(7);
      },
    );
    gesture.down(1, { x: 10, y: 10 }, 2, 0);
    gesture.up(1, { x: 10, y: 10 }, 20);
    expect(sent).toEqual([{ t: 'move', unitIds: [10], to: 7 }]);
  });

  it('не выбирает центр radial', () => {
    const state: RadialMenuState = {
      center: { x: 100, y: 100 },
      actions: [{ kind: 'merge', label: 'merge' }],
      active: [{ kind: 'merge', label: 'merge' }],
    };
    expect(sectorAt(state, { x: 100, y: 100 })).toBeNull();
  });
});
