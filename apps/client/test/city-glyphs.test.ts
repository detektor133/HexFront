import { describe, expect, it } from 'vitest';

import { cityLabelVisible, cityLabelsKey, citySize } from '../src/dev/city-glyphs.ts';

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

  it('на z1 показывает только столицы и города уровня 2 или выше', () => {
    expect(cityLabelVisible(1, false, 1)).toBe(false);
    expect(cityLabelVisible(1, true, 1)).toBe(true);
    expect(cityLabelVisible(2, false, 1)).toBe(true);
    expect(cityLabelVisible(1, false, 2)).toBe(true);
  });

  it('меняет ключ подписей только при изменении города или детализации', () => {
    const cities = [{ name: 'Рига', level: 1, isCapital: false }];
    expect(cityLabelsKey(cities, 1, 2)).toBe(cityLabelsKey(cities, 1, 2));
    expect(cityLabelsKey(cities, 1, 2)).not.toBe(cityLabelsKey(cities, 1, 3));
    expect(cityLabelsKey(cities, 1, 2)).not.toBe(
      cityLabelsKey([{ name: 'Рига', level: 2, isCapital: false }], 1, 2),
    );
  });
});
