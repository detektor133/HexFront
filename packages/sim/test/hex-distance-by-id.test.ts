import { describe, expect, it } from 'vitest';

import { distance, hexDistanceById, hexFromId } from '../src/math/hex.ts';

describe('hexDistanceById', () => {
  it('совпадает с distance по hexFromId на всех парах небольшой карты', () => {
    const width = 11;
    const height = 9;
    for (let a = 0; a < width * height; a += 1) {
      for (let b = 0; b < width * height; b += 1) {
        expect(hexDistanceById(a, b, width)).toBe(
          distance(hexFromId(a, width), hexFromId(b, width)),
        );
      }
    }
  });
});
