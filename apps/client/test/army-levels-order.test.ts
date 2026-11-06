import { describe, expect, it } from 'vitest';

import type { ArmyView, MapStatic, PlayerView } from '@hexfront/sim';

import { armyLevels, stepSize } from '../src/dev/army-limit.ts';
import { autoOrder, contacts, isFree, nearestFreeArmy, orderArmy } from '../src/dev/army-order.ts';
import { NEW_ARMY } from '../src/dev/direction-order.ts';

const FP = 1000;

// Карта 4×1: гексы 0,1 — свои (игрок 0), 2,3 — игрока 1.
const map = { width: 4, height: 1 } as unknown as MapStatic;

const army = (id: number, number: number, dir?: ArmyView['dir']): ArmyView => ({
  id,
  number,
  name: '',
  auto: false,
  ...(dir ? { dir } : {}),
});

function viewWith(armies: ArmyView[], units: { hex: number; armyId: number }[]): PlayerView {
  return {
    playerId: 0,
    players: [{ status: 'alive' }, { status: 'alive' }],
    hexes: { owner: [0, 0, 1, 1] },
    armies,
    units: units.map((u, id) => ({
      id,
      owner: 0,
      type: 'infantry',
      soldiers: 100 * FP,
      hex: u.hex,
      armyId: u.armyId,
    })),
    me: { popTotal: 0 },
  } as unknown as PlayerView;
}

describe('уровни размера армии', () => {
  it('уровни растут вдвое от предела и не повторяются на малой карте', () => {
    expect(armyLevels(160)).toEqual([10, 20, 40, 80, 160]);
    expect(armyLevels(3)).toEqual([1, 2, 3]);
  });

  it('шаг «+/−» — доля текущего размера: растёт с армией, не ниже одного и не выше предела', () => {
    expect(stepSize(400, 25, 1, 1000)).toBe(500);
    expect(stepSize(400, 25, -1, 1000)).toBe(300);
    expect(stepSize(50, 10, 1, 1000)).toBe(55);
    expect(stepSize(3, 10, 1, 1000)).toBe(4);
    expect(stepSize(1, 50, -1, 1000)).toBe(1);
    expect(stepSize(900, 50, 1, 1000)).toBe(1000);
    expect(stepSize(1000, 25, 1, 1000)).toBe(1000);
  });
});

describe('приказы армиям', () => {
  it('граница с соседом находится по общим граням', () => {
    const found = contacts(viewWith([], []), map);
    expect([...found]).toEqual([[1, 1]]);
  });

  it('свободная армия — без приказа; ближайшая к гексу выбирается первой', () => {
    const near = army(1, 1);
    const far = army(2, 2);
    const busy = army(3, 3, { target: 1, mode: 'hold' });
    const view = viewWith(
      [far, busy, near],
      [
        { hex: 0, armyId: 2 },
        { hex: 1, armyId: 1 },
        { hex: 1, armyId: 3 },
      ],
    );
    expect(isFree(busy)).toBe(false);
    expect(nearestFreeArmy(view, map, 1)?.id).toBe(1);
    expect(nearestFreeArmy(view, map, 0)?.id).toBe(2);
  });

  it('автоподбор: армия, уже стоящая на цель, иначе свободная, иначе новая в паритете', () => {
    const holding = army(1, 1, { target: 1, mode: 'hold' });
    const view = viewWith([holding], [{ hex: 1, armyId: 1 }]);
    expect(autoOrder(view, map, 1, 'attack', 1)).toMatchObject({
      t: 'launchOffensive',
      target: 1,
      armyId: 1,
    });
    const busy = army(2, 2, { target: -1, mode: 'attack' });
    const noFree = viewWith([busy], [{ hex: 0, armyId: 2 }]);
    expect(autoOrder(noFree, map, 1, 'hold', 1)).toMatchObject({
      t: 'holdBorder',
      target: 1,
      armyId: NEW_ARMY,
    });
    const free = viewWith([army(3, 3)], [{ hex: 0, armyId: 3 }]);
    expect(autoOrder(free, map, 1, 'hold', 1)).toMatchObject({ armyId: 3 });
  });

  it('приказ выбранной армии заменяет её приказ и хранит размер армии', () => {
    const busy = army(5, 1, { target: 2, mode: 'attack' });
    const view = viewWith([busy], [{ hex: 0, armyId: 5 }]);
    expect(orderArmy(view, busy, 1, 'hold')).toMatchObject({
      t: 'holdBorder',
      target: 1,
      armyId: 5,
      soldiers: 100,
    });
  });
});
