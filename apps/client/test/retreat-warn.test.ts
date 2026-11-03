import { describe, expect, it } from 'vitest';

import { isRetreatSoon } from '../src/dev/unit-chips.ts';
import { tokens } from '../src/theme/tokens.ts';

describe('индикатор скорого отступления', () => {
  const share = tokens.chip.retreatWarnShare;

  it('виден у своего отряда в бою на пороге и ниже', () => {
    expect(isRetreatSoon(share, true, true)).toBe(true);
    expect(isRetreatSoon(0.1, true, true)).toBe(true);
  });

  it('не виден выше порога, вне боя и у чужих', () => {
    expect(isRetreatSoon(share + 0.01, true, true)).toBe(false);
    expect(isRetreatSoon(0.1, false, true)).toBe(false);
    expect(isRetreatSoon(0.1, true, false)).toBe(false);
  });
});
