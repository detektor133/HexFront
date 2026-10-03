import { describe, expect, it } from 'vitest';

import { validateGeneratedMap } from '../src/index.ts';

describe('итоговый генератор карты', () => {
  it('проходит валидацию на 100 сидах для 30 игроков', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      expect(validateGeneratedMap(seed, { width: 80, height: 60, players: 30 })).toEqual([]);
    }
  }, 60_000);
});
