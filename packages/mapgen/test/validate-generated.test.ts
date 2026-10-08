import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { generateMap, validateGeneratedMap } from '../src/index.ts';

describe('итоговый генератор карты', () => {
  it('проходит валидацию на 100 сидах для 30 игроков', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      expect(validateGeneratedMap(seed, { width: 80, height: 60, players: 30 })).toEqual([]);
    }
  }, 60_000);

  it('сохраняет хэши JSON для контрольных сидов', () => {
    const expected = [
      'c63225bb1058f2e60fa4a4d2ffc81879e761778b27612d023b09bf4df7d8efe6',
      '2adced83ea5faae5dce8c9bc80be25573e615e7232fafcf997fb0e66ef2ed847',
      '265047b88af93a60fa08db04e32ad5cfe6a44970fc117d4ec3d3ea00a7042efc',
      '192eb2377bb4a61f8f1f6a87c9b187f26e4e0bb35d7d4b5e696c4361636a18ba',
      'f8632b8a69eb326220a8f8eae8e8aeee482de8fc3918f0f57c631771cc4bff59',
    ];
    const actual = expected.map((_, seed) => {
      const json = generateMap(seed, { width: 80, height: 60, players: 30 });
      return createHash('sha256').update(JSON.stringify(json)).digest('hex');
    });
    expect(actual).toEqual(expected);
  });
});
