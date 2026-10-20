// @vitest-environment jsdom

import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, type PlayerView, type UnitView } from '@hexfront/sim';

import { ArmyBar } from '../src/dev/ArmyBar.tsx';
import { sectorAt, sectorCenter, type RadialMenuState } from '../src/dev/radial-menu.ts';
import {
  createRadialActionHandler,
  focusUnitOnDoubleTap,
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
  plans: [],
  me: { autoReinforce: false },
} as unknown as PlayerView;
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
    if (!state) throw new Error('radial артиллерии не открыт');
    const bombard = sectorCenter(state, 1);
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
    const onDoubleTap = (): void =>
      focusUnitOnDoubleTap({
        view,
        map: { width: 3 } as never,
        hex: { q: 1, r: 1 },
        picked: { hex: null, units: [], target: null },
        hit: [10],
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
        if (event.t === 'doubleTap') onDoubleTap();
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
        if (event.t === 'tap' && event.kind === 'order') sent.push({ t: 'order', hex: 7 });
      },
    );
    gesture.down(1, { x: 10, y: 10 }, 2, 0);
    gesture.up(1, { x: 10, y: 10 }, 20);
    expect(sent).toEqual([{ t: 'order', hex: 7 }]);
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
