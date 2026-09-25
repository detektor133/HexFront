import { describe, expect, it } from 'vitest';

import { citySize } from '../src/dev/city-glyphs.ts';

describe('знак города', () => {
  it('растёт с уровнем', () => {
    const sizes = [1, 2, 3, 4, 5].map((level) => citySize(20, level));
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    expect(new Set(sizes).size).toBe(5);
  });

  it('задан в долях радиуса гекса: при приближении растёт вместе с картой', () => {
    // Размер не зависит от масштаба камеры, поэтому на экране он умножается на масштаб.
    expect(citySize(40, 3)).toBe(citySize(20, 3) * 2);
    expect(citySize(20, 1) / 20).toBeCloseTo(0.36, 5);
  });
});
