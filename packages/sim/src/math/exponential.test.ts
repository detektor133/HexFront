import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ANALYTIC_FP,
  decayDeficit,
  decayOvercap,
  expNegFixed,
  growthIntegral,
  growthRate,
} from './exponential.ts';
import { fp, type Fp } from './int.ts';

describe('аналитическая fixed-point математика', () => {
  it('экспонента совпадает с контрольными значениями', () => {
    expect(expNegFixed(0)).toBe(ANALYTIC_FP);
    expect(expNegFixed(100_000)).toBeCloseTo(904_837, -2);
    expect(expNegFixed(1_000_000)).toBeCloseTo(367_879, -2);
  });

  it('экспонента монотонно убывает и насыщается нулём', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20_000_000 }), (argument) => {
        expect(expNegFixed(argument)).toBeGreaterThanOrEqual(expNegFixed(argument + 1));
      }),
      { numRuns: 100 },
    );
    expect(expNegFixed(20 * ANALYTIC_FP)).toBe(0);
    expect(expNegFixed(100 * ANALYTIC_FP)).toBe(0);
  });

  it('сохраняет детерминированность и диапазон на больших дефицитах', () => {
    const deficit = 10_000_000_000;
    const rate = growthRate(fp(3) as Fp, fp(200_000) as Fp);
    const deltaM = growthIntegral(fp(1.4) as Fp, 15_000);
    const first = decayDeficit(deficit, rate, deltaM);
    expect(first).toBe(decayDeficit(deficit, rate, deltaM));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(deficit);
  });

  it('сравнивает аналитическое затухание с мелким пошаговым расчётом', () => {
    const deficit = 600_000;
    const rate = growthRate(fp(0.4) as Fp, fp(100) as Fp);
    const ticks = 15_000;
    const analytic = decayDeficit(deficit, rate, growthIntegral(fp(1) as Fp, ticks));
    const fineScale = 1_000_000_000_000n;
    const analyticScale = BigInt(ANALYTIC_FP);
    let stepped = (BigInt(deficit) * fineScale) / analyticScale;
    const fineSteps = ticks * 100;
    const stepArgument = (BigInt(rate) * fineScale) / (analyticScale * 1_000n);
    const stepFactor = fineScale - stepArgument;
    for (let tick = 0; tick < fineSteps; tick += 1) {
      stepped = (stepped * stepFactor) / fineScale;
    }
    const steppedFixed = Number((stepped * analyticScale) / fineScale);
    expect(Math.abs(analytic - steppedFixed)).toBeLessThanOrEqual(1);
  });

  it('рассчитывает убыль сверх лимита той же экспонентой', () => {
    const excess = fp(100) as Fp;
    expect(decayOvercap(excess, 0)).toBe(excess);
    expect(decayOvercap(excess, 10)).toBeLessThan(excess);
    expect(decayOvercap(excess, 100_000)).toBeGreaterThanOrEqual(0);
  });
});
