import { describe, expect, it } from 'vitest';

import { shiftInward } from '../src/dev/plan-layer.ts';

describe('слои линий фронта', () => {
  it('точки сдвигаются к ближайшему центру своего гекса на заданную величину', () => {
    const runs = [
      [
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ],
    ];
    const centers = [{ x: 5, y: 0 }];
    const [run] = shiftInward(runs, centers, 2);
    expect(run?.[0]?.y).toBeLessThan(10);
    expect(run?.[1]?.y).toBeLessThan(10);
    const moved = Math.hypot((run?.[0]?.x ?? 0) - 0, (run?.[0]?.y ?? 0) - 10);
    expect(moved).toBeCloseTo(2, 5);
  });

  it('нулевой сдвиг и пустой список центров ничего не двигают', () => {
    const runs = [[{ x: 1, y: 2 }]];
    expect(shiftInward(runs, [], 5)).toEqual(runs);
    expect(shiftInward(runs, [{ x: 0, y: 0 }], 0)).toEqual(runs);
  });
});
