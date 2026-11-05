import { describe, expect, it } from 'vitest';

import { countsFromShares, setShare, sharesFromCounts } from '../src/dev/force-share.ts';

describe('доли состава', () => {
  it('тянешь одну долю — остальные подстраиваются, сумма 100', () => {
    const next = setShare({ infantry: 75, armor: 20, artillery: 5 }, 'armor', 40);
    expect(next.armor).toBe(40);
    expect(next.infantry + next.armor + next.artillery).toBe(100);
    expect(next.infantry).toBeGreaterThan(next.artillery);
  });

  it('если остальные нули, остаток уходит первому из них', () => {
    const next = setShare({ infantry: 100, armor: 0, artillery: 0 }, 'infantry', 60);
    expect(next).toEqual({ infantry: 60, armor: 40, artillery: 0 });
  });

  it('число делится по долям, пехота — остаток, сумма равна общему числу', () => {
    const counts = countsFromShares(457, { infantry: 75, armor: 20, artillery: 5 });
    expect(counts.armor).toBe(91);
    expect(counts.artillery).toBe(23);
    expect(counts.infantry + counts.armor + counts.artillery).toBe(457);
  });

  it('доли готового состава возвращаются в проценты', () => {
    expect(sharesFromCounts({ infantry: 300, armor: 100, artillery: 100 })).toEqual({
      infantry: 60,
      armor: 20,
      artillery: 20,
    });
  });
});
