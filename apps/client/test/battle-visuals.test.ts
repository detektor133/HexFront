import { describe, expect, it } from 'vitest';

import {
  battlePulseScale,
  captureProgress,
  cityFlashAlpha,
  encircledDashOffset,
} from '../src/dev/battle-visuals.ts';

describe('анимации боя и захвата (04/T6)', () => {
  it('маркер боя пульсирует в заданном диапазоне и замирает при reduced motion', () => {
    expect(battlePulseScale(0, false)).toBeCloseTo(1.075, 5);
    expect(battlePulseScale(200, false)).toBeCloseTo(1.15, 5);
    expect(battlePulseScale(0, true)).toBe(1);
    expect(battlePulseScale(200, true)).toBe(1);
  });

  it('захват завершается за 300 мс, а reduced motion сразу показывает результат', () => {
    expect(captureProgress(0, false)).toBe(0);
    expect(captureProgress(150, false)).toBeGreaterThan(0);
    expect(captureProgress(300, false)).toBe(1);
    expect(captureProgress(0, true)).toBe(1);
  });

  it('вспышка города даёт два пульса и отключает пульсации при reduced motion', () => {
    expect(cityFlashAlpha(0, false)).toBeCloseTo(0.5, 5);
    expect(cityFlashAlpha(38, false)).toBeGreaterThan(0.9);
    expect(cityFlashAlpha(300, false)).toBeCloseTo(0.5, 5);
    expect(cityFlashAlpha(0, true)).toBe(1);
  });

  it('контур котла не двигается при reduced motion', () => {
    expect(encircledDashOffset(1000, 11, false)).toBe(1);
    expect(encircledDashOffset(1000, 11, true)).toBe(0);
  });
});
