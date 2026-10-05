import { describe, expect, it } from 'vitest';

import { percentile } from '../src/dev/telemetry.ts';

describe('телеметрия стенда', () => {
  it('считает p50 и p95 по отсортированной копии кадров', () => {
    const samples = [20, 1, 5, 10, 15];

    expect(percentile(samples, 0.5)).toBe(10);
    expect(percentile(samples, 0.95)).toBe(20);
    expect(samples).toEqual([20, 1, 5, 10, 15]);
  });
});
