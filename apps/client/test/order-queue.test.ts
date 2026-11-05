import { describe, expect, it } from 'vitest';

import { MAX_VIA_POINTS, type PlayerView, type UnitView } from '@hexfront/sim';

import { EMPTY_QUEUE, queueOrder, remainingPoints } from '../src/dev/order-queue.ts';
import type { Picked } from '../src/dev/sandbox-selection.ts';

const unit = (over: Partial<UnitView>): UnitView =>
  ({
    id: 1,
    owner: 0,
    type: 'infantry',
    hex: 10,
    order: 'idle',
    path: [],
    ...over,
  }) as UnitView;

const view = (units: UnitView[]): PlayerView =>
  ({
    playerId: 0,
    units,
    cities: [],
    hexes: { owner: new Int16Array(100) },
  }) as unknown as PlayerView;

const picked: Picked = { hex: null, units: [1], target: null };

describe('цепочка приказов Shift+ПКМ', () => {
  it('первая точка — обычный приказ move без via', () => {
    const next = queueOrder(view([unit({})]), picked, 20, EMPTY_QUEUE);
    expect(next?.cmd).toEqual({ t: 'move', unitIds: [1], to: 20 });
    expect(next?.queue.points).toEqual([20]);
  });

  it('вторая точка продолжает цепочку: первая становится via', () => {
    const first = queueOrder(view([unit({})]), picked, 20, EMPTY_QUEUE);
    if (!first) throw new Error('нет первого приказа');
    const moving = view([unit({ order: 'move', path: [15, 20] })]);
    const second = queueOrder(moving, picked, 30, first.queue);
    expect(second?.cmd).toEqual({ t: 'move', unitIds: [1], to: 30, via: [20] });
    expect(second?.queue.points).toEqual([20, 30]);
  });

  it('достигнутые точки выпадают из цепочки', () => {
    const queue = { key: '1', points: [20, 30] };
    const moving = view([unit({ order: 'move', path: [25, 30] })]);
    expect(remainingPoints(moving, picked, queue)).toEqual([30]);
  });

  it('отряд идёт обычным приказом — цепочка продолжается с его цели', () => {
    const moving = view([unit({ order: 'move', path: [15, 20] })]);
    const next = queueOrder(moving, picked, 30, EMPTY_QUEUE);
    expect(next?.cmd).toEqual({ t: 'move', unitIds: [1], to: 30, via: [20] });
  });

  it('цепочка длиннее MAX_VIA_POINTS + 1 не принимается', () => {
    const queue = {
      key: '1',
      points: Array.from({ length: MAX_VIA_POINTS + 1 }, (_, i) => 20 + i),
    };
    const moving = view([unit({ order: 'move', path: queue.points })]);
    expect(queueOrder(moving, picked, 99, queue)).toBeNull();
  });
});
