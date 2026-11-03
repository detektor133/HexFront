import { describe, expect, it } from 'vitest';

import { neighbors } from '@hexfront/sim';

import { attackShift } from '../src/dev/chip-place.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';

describe('сдвиг фишки атакующего', () => {
  const radius = 40;
  const here = { q: 4, r: 4 };
  const from = hexCenter(here, radius);

  it('для всех шести направлений — середина между центром гекса и серединой общей грани', () => {
    neighbors(here).forEach((n) => {
      const to = hexCenter(n, radius);
      const edge = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const shift = attackShift(from, to);
      expect(from.x + shift.x).toBeCloseTo((from.x + edge.x) / 2);
      expect(from.y + shift.y).toBeCloseTo((from.y + edge.y) / 2);
    });
  });
});
