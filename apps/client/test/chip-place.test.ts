import { describe, expect, it } from 'vitest';

import { chipHalf, cityChipShift, starRadius } from '../src/dev/chip-place.ts';
import { tokens } from '../src/theme/tokens.ts';

describe('фишка под городом (04/T17)', () => {
  const R = tokens.map.hexRadius;

  it('на всех уровнях верх фишки с рамкой выбора — ниже звезды столицы', () => {
    for (let level = 1; level <= tokens.city.sizeByLevel.length; level += 1) {
      const top = cityChipShift(level, R) - chipHalf();
      expect(top, `уровень ${level}`).toBeGreaterThan(starRadius(level, R));
    }
  });

  it('фишка остаётся в своём гексе: центр выше нижней грани гекса', () => {
    const apothem = (R * Math.sqrt(3)) / 2;
    for (let level = 1; level <= tokens.city.sizeByLevel.length; level += 1) {
      expect(cityChipShift(level, R), `уровень ${level}`).toBeLessThan(apothem);
    }
  });
});
