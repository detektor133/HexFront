import { describe, expect, it } from 'vitest';

import { FP } from '../src/math/int.ts';
import { unitCap } from '../src/systems/consolidate.ts';

describe('предел отряда зависит от размера войска', () => {
  it('небольшое войско — базовый предел, большое — крупнее, но не выше потолка', () => {
    expect(unitCap(2_000 * FP)).toBe(300 * FP);
    expect(unitCap(20_000 * FP)).toBe(800 * FP);
    expect(unitCap(1_000_000 * FP)).toBe(1500 * FP);
  });
});
