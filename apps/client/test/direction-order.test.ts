import { describe, expect, it } from 'vitest';

import type { ArmyView, PlayerView } from '@hexfront/sim';

import {
  NEW_ARMY,
  armyCounts,
  orderFields,
  setCount,
  totalOf,
} from '../src/dev/direction-order.ts';

const view = { playerId: 0, units: [] } as unknown as PlayerView;
const army = (extra: Partial<ArmyView>): ArmyView => ({
  id: 5,
  number: 1,
  name: '',
  auto: false,
  ...extra,
});

describe('приказ направления', () => {
  it('состав армии с лимитом берётся из заказа, пехота — остаток', () => {
    expect(armyCounts(view, army({ wanted: 500, mix: { armor: 100, artillery: 50 } }))).toEqual({
      infantry: 350,
      armor: 100,
      artillery: 50,
    });
  });

  it('число одного типа не выводит сумму за предел', () => {
    const counts = { infantry: 200, armor: 50, artillery: 0 };
    expect(setCount(counts, 'infantry', 999, 300).infantry).toBe(250);
    expect(setCount(counts, 'armor', -4, 300).armor).toBe(0);
    expect(totalOf(setCount(counts, 'artillery', 1000, 300))).toBe(300);
  });

  it('поля приказа: армия, сумма и состав только если есть техника', () => {
    expect(orderFields({ infantry: 100, armor: 0, artillery: 0 }, NEW_ARMY)).toEqual({
      soldiers: 100,
      armyId: -1,
    });
    expect(orderFields({ infantry: 100, armor: 20, artillery: 0 }, 5)).toEqual({
      soldiers: 120,
      armyId: 5,
      mix: { armor: 20, artillery: 0 },
    });
  });
});
