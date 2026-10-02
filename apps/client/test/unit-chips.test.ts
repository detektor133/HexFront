import { describe, expect, it } from 'vitest';

import { supplyColor } from '../src/dev/unit-chips.ts';
import { tokens } from '../src/theme/tokens.ts';

describe('состояния фишки отряда (04/T5)', () => {
  it('показывает жёлтое снабжение ниже 75 процентов и красное ниже 50', () => {
    expect(supplyColor(0.74, false)).toBe(tokens.status.lowSupply);
    expect(supplyColor(0.75, false)).toBe(tokens.chip.supply);
    expect(supplyColor(0.49, false)).toBe(tokens.status.danger);
  });

  it('показывает истощение красным даже при достаточном запасе', () => {
    expect(supplyColor(0.9, true)).toBe(tokens.status.danger);
  });
});
