import { describe, expect, it } from 'vitest';

import type { PlayerView, UnitView } from '@hexfront/sim';

import {
  buildRadialActions,
  sectorAt,
  sectorCenter,
  type RadialMenuState,
} from '../src/dev/radial-menu.ts';
import { RADIAL_MENU_LONG_PRESS_MS, createGesture } from '../src/render/gesture.ts';

describe('07/T17an: радиальное меню', () => {
  it('строит merge и assignUnits с точными payload, а artillery добавляет bombard', () => {
    const unit = {
      id: 10,
      owner: 0,
      armyId: 1,
      hex: 4,
      type: 'infantry',
    } as const as unknown as UnitView;
    const second = { ...unit, id: 11 };
    const view = {
      playerId: 0,
      armies: [
        { id: 1, number: 1, name: '', auto: false },
        { id: 2, number: 2, name: '', auto: false },
      ],
    } as unknown as PlayerView;
    const actions = buildRadialActions([unit, second], view);
    expect(actions.map((action) => action.kind)).toEqual(['merge', 'assignUnits']);
    expect(actions[0]?.command).toEqual({ t: 'merge', unitIds: [10, 11] });
    expect(actions[1]?.children?.map((action) => action.command)).toEqual([
      { t: 'assignUnits', unitIds: [10, 11], armyId: 1 },
      { t: 'assignUnits', unitIds: [10, 11], armyId: 2 },
      { t: 'assignUnits', unitIds: [10, 11], armyId: null },
    ]);
    const artillery = { ...unit, id: 12, type: 'artillery' as const };
    expect(buildRadialActions([artillery], view).at(-1)?.command).toEqual({
      t: 'bombard',
      unitId: 12,
      targetUnitId: null,
    });
  });

  it('определяет сектор по координате центра сектора', () => {
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

  it('использует отдельный порог 400 мс и не меняет удержание 350 мс', () => {
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
    gesture.up(1, { x: 188, y: 100 }, 450);
    expect(events).toEqual(['radial', 'radial']);
  });

  it('выдаёт doubleTap вместо второго select в пределах 350 мс', () => {
    const events: string[] = [];
    const gesture = createGesture(
      {
        drawing: () => false,
        press: () => undefined,
        release: () => undefined,
        canHold: () => false,
        cancelZone: () => false,
        inside: () => true,
      },
      (event) => events.push(event.t),
    );
    gesture.down(1, { x: 20, y: 30 }, 0, 0);
    gesture.up(1, { x: 20, y: 30 }, 50);
    gesture.down(1, { x: 20, y: 30 }, 0, 200);
    gesture.up(1, { x: 20, y: 30 }, 300);
    expect(events).toEqual(['tap', 'doubleTap']);
  });
});
