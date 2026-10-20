import { describe, expect, it } from 'vitest';

import { hexFromId, type PlayerView, type UnitView } from '@hexfront/sim';

import {
  buildRadialActions,
  sectorAt,
  sectorCenter,
  type RadialMenuState,
} from '../src/dev/radial-menu.ts';
import {
  createRadialActionHandler,
  focusUnitOnDoubleTap,
} from '../src/match/MatchSurfaceRuntime.tsx';
import { RADIAL_MENU_LONG_PRESS_MS, createGesture } from '../src/render/gesture.ts';
import { tokens } from '../src/theme/tokens.ts';

const unit = { id: 10, owner: 0, armyId: 1, hex: 4, type: 'infantry' } as unknown as UnitView;
const view = {
  playerId: 0,
  units: [unit, { ...unit, id: 11 }],
  armies: [
    { id: 1, number: 1, name: '', auto: false },
    { id: 2, number: 2, name: '', auto: false },
  ],
} as unknown as PlayerView;

describe('07/T17an: радиальное меню', () => {
  it('строит полный набор корневых действий и payload', () => {
    const actions = buildRadialActions(view.units, view);
    expect(actions.map((action) => action.kind)).toEqual(['merge', 'assignUnits']);
    expect(actions[0]?.command).toEqual({ t: 'merge', unitIds: [10, 11] });
    expect(actions[1]?.children?.map((action) => action.command)).toEqual([
      { t: 'assignUnits', unitIds: [10, 11], armyId: 1 },
      { t: 'assignUnits', unitIds: [10, 11], armyId: 2 },
      { t: 'assignUnits', unitIds: [10, 11], armyId: null },
    ]);
    const artillery = { ...unit, id: 12, type: 'artillery' as const };
    const artilleryActions = buildRadialActions([artillery], view);
    expect(artilleryActions.map((action) => action.kind)).toEqual(['assignUnits', 'bombard']);
    expect(artilleryActions[0]?.command).toBeUndefined();
    expect(artilleryActions[1]?.command).toEqual({ t: 'bombard', unitId: 12, targetUnitId: null });
  });

  it('определяет сектор по центру и не выбирает центр меню', () => {
    const state: RadialMenuState = {
      center: { x: 100, y: 100 },
      actions: [
        { kind: 'merge', label: 'merge' },
        { kind: 'assignUnits', label: 'assign' },
      ],
      active: [
        { kind: 'merge', label: 'merge' },
        { kind: 'assignUnits', label: 'assign' },
      ],
    };
    expect(sectorAt(state, sectorCenter(state, 0))?.kind).toBe('merge');
    expect(sectorAt(state, { x: 100, y: 100 })).toBeNull();
  });

  it('использует порог radial 400 мс, не меняя удержание 350 мс', () => {
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

  it('проводит удержание через runtime до send для merge и bombard', () => {
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
    const gesture = createGesture(
      {
        drawing: () => false,
        press: () => undefined,
        release: () => undefined,
        canHold: () => false,
        canRadial: () => true,
        cancelZone: () => false,
        inside: () => true,
      },
      (event) => {
        if (event.t === 'radial') radial(1, event.at, event.phase);
      },
    );
    gesture.down(1, { x: 100, y: 100 }, 0, 0);
    gesture.tick(RADIAL_MENU_LONG_PRESS_MS);
    expect((state as RadialMenuState | null)?.center).toEqual({ x: 100, y: 100 });
    const mergeState = state;
    if (!mergeState) throw new Error('radial state was not opened');
    gesture.up(1, sectorCenter(mergeState, 0), 450);
    expect(sent).toEqual([{ t: 'merge', unitIds: [10, 11] }]);
    const artillery = { ...unit, id: 12, type: 'artillery' as const };
    const artilleryView = { ...view, units: [artillery] } as unknown as PlayerView;
    state = null;
    const artilleryRadial = createRadialActionHandler({
      getView: () => artilleryView,
      send: (command) => sent.push(command),
      getState: () => state,
      setState: (next) => {
        state = next;
      },
    });
    artilleryRadial(1, { x: 100, y: 100 }, 'start');
    const artilleryState = state;
    if (!artilleryState) throw new Error('artillery radial state was not opened');
    artilleryRadial(1, sectorCenter(artilleryState, 1), 'end');
    expect(sent.at(-1)).toEqual({ t: 'bombard', unitId: 12, targetUnitId: null });
  });

  it('отменяет radial после смещения и при отпускании вне секторов', () => {
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
    const gesture = createGesture(
      {
        drawing: () => false,
        press: () => undefined,
        release: () => undefined,
        canHold: () => false,
        canRadial: () => true,
        cancelZone: () => false,
        inside: (point) => point.x < 300,
      },
      (event) => {
        if (event.t === 'radial') radial(1, event.at, event.phase);
      },
    );
    gesture.down(1, { x: 100, y: 100 }, 0, 0);
    gesture.tick(400);
    gesture.move(1, { x: 301, y: 100 }, 401);
    expect(state).toBeNull();
    radial(1, { x: 100, y: 100 }, 'start');
    radial(1, { x: 100, y: 100 }, 'end');
    expect(sent).toEqual([]);
  });

  it('выделяет фишку и фокусирует камеру на 250 мс', () => {
    const calls: unknown[] = [];
    focusUnitOnDoubleTap({
      view,
      map: { width: 3 } as never,
      hex: { q: 1, r: 1 },
      picked: { hex: null, units: [], target: null },
      hit: [10],
      pick: (picked) => calls.push(picked),
      centerOn: (hex, duration) => calls.push({ hex, duration }),
    });
    expect(calls[0]).toEqual({ hex: null, units: [10], target: null });
    expect(calls[1]).toEqual({ hex: hexFromId(4, 3), duration: tokens.motion.map });
    expect(tokens.motion.map).toBe(250);
  });

  it('сохраняет немедленный приказ ПКМ без radial', () => {
    const kinds: string[] = [];
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
        if (event.t === 'tap') kinds.push(event.kind);
      },
    );
    gesture.down(1, { x: 10, y: 10 }, 2, 0);
    gesture.up(1, { x: 10, y: 10 }, 20);
    expect(kinds).toEqual(['order']);
  });
});
