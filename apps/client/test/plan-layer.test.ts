import { describe, expect, it } from 'vitest';

import { isPointNearPath } from '../src/dev/plan-layer.ts';

describe('прогноз у линии наступления', () => {
  const path = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  ] as const;

  it('показывает попадание рядом с отрезком', () => {
    expect(isPointNearPath({ x: 50, y: 10 }, path, 10)).toBe(true);
  });

  it('скрывает прогноз далеко от линии', () => {
    expect(isPointNearPath({ x: 50, y: 11 }, path, 10)).toBe(false);
  });

  it('учитывает короткий отрезок и его концы', () => {
    expect(isPointNearPath({ x: -5, y: 0 }, path, 5)).toBe(true);
  });
});
