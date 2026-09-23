import { describe, expect, it } from 'vitest';

import { createRng, fork, nextInt, nextRange, nextU32, rngFromState, type Rng } from './rng.ts';

const take = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => nextU32(rng));

const popcount = (x: number): number => {
  let v = x >>> 0;
  let c = 0;
  while (v !== 0) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
};

describe('seeded PRNG xoshiro128**', () => {
  it('совпадает с эталонным вектором алгоритма для состояния (1, 2, 3, 4)', () => {
    // Вектор из эталонной реализации (rand_xoshiro, Xoshiro128StarStar).
    expect(take(rngFromState([1, 2, 3, 4]), 10)).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597,
      4258142804,
    ]);
  });

  it('даёт зафиксированную последовательность для сида 42', () => {
    // Эталон: изменение значит, что изменился алгоритм или разворот сида, — ломает реплеи.
    expect(take(createRng(42), 8)).toEqual([
      2837322924, 544945897, 479756282, 3500138142, 339756180, 113173290, 65323186, 1112262688,
    ]);
  });

  it('повторяет последовательность при одинаковом сиде', () => {
    expect(take(createRng(7), 100)).toEqual(take(createRng(7), 100));
  });

  it('отклоняет нулевое состояние', () => {
    expect(() => rngFromState([0, 0, 0, 0])).toThrow(RangeError);
  });

  it('fork даёт разные и некоррелированные потоки', () => {
    const a = take(fork(42, 0), 2000);
    const b = take(fork(42, 1), 2000);
    const c = take(fork(43, 0), 2000);
    for (const other of [b, c]) {
      let sameBits = 0;
      a.forEach((x, i) => {
        sameBits += 32 - popcount((x ^ (other[i] ?? 0)) >>> 0);
      });
      const share = sameBits / (2000 * 32);
      expect(share).toBeGreaterThan(0.48);
      expect(share).toBeLessThan(0.52);
      expect(new Set([...a, ...other]).size).toBeGreaterThan(3990);
    }
  });

  it('fork детерминирован', () => {
    expect(take(fork(42, 3), 20)).toEqual(take(fork(42, 3), 20));
  });

  it('nextInt равномерен и не выходит за границу', () => {
    const rng = createRng(1);
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 60_000; i += 1) {
      const x = nextInt(rng, 6);
      counts[x] = (counts[x] ?? 0) + 1;
    }
    for (const c of counts) {
      expect(c).toBeGreaterThan(9_500);
      expect(c).toBeLessThan(10_500);
    }
    expect(() => nextInt(rng, 0)).toThrow(RangeError);
  });

  it('nextRange включает обе границы', () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) seen.add(nextRange(rng, -2, 2));
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2]);
  });
});
