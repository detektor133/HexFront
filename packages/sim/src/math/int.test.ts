import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { clamp, floorDiv, fp, fpDiv, fpMul, intDiv, type Fp } from './int.ts';

// Граница из sim-core.md: население и солдаты ≤ 10⁷ единиц, т. е. ≤ 10¹⁰ в fixed-point.
const MAX_AMOUNT = 10_000_000_000;
// Множитель до 900,0: |a·b| ≤ 9·10¹⁵ < 2⁵³.
const MAX_FACTOR = 900_000;

const bigTrunc = (a: bigint, b: bigint): number => Number(a / b);

describe('fixed-point', () => {
  it('fp переводит десятичную константу в целое ×1000 с округлением', () => {
    expect(fp(1.5)).toBe(1500);
    expect(fp(1.005)).toBe(1005);
    expect(fp(-0.25)).toBe(-250);
    expect(fp(0)).toBe(0);
  });

  it('fp отклоняет значения за пределами безопасных целых', () => {
    expect(() => fp(1e16)).toThrow(RangeError);
  });

  it('intDiv усекает к нулю и не возвращает -0', () => {
    expect(intDiv(7, 2)).toBe(3);
    expect(intDiv(-7, 2)).toBe(-3);
    expect(Object.is(intDiv(-1, 2), 0)).toBe(true);
    expect(() => intDiv(1, 0)).toThrow(RangeError);
  });

  it('floorDiv округляет к минус бесконечности', () => {
    expect(floorDiv(7, 2)).toBe(3);
    expect(floorDiv(-7, 2)).toBe(-4);
    expect(floorDiv(-6, 2)).toBe(-3);
    expect(floorDiv(7, -2)).toBe(-4);
  });

  it('intDiv и floorDiv совпадают с эталоном на BigInt', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e12 }),
        fc.integer({ min: -1e6, max: 1e6 }).filter((b) => b !== 0),
        (a, b) => {
          expect(intDiv(a, b)).toBe(bigTrunc(BigInt(a), BigInt(b)));
          const q = bigTrunc(BigInt(a), BigInt(b));
          const expected = q * b !== a && a < 0 !== b < 0 ? q - 1 : q;
          expect(floorDiv(a, b)).toBe(expected);
        },
      ),
    );
  });

  it('fpMul точен на граничных значениях из sim-core.md', () => {
    const cases: [number, number][] = [
      [MAX_AMOUNT, 1000],
      [MAX_AMOUNT, MAX_FACTOR],
      [-MAX_AMOUNT, MAX_FACTOR],
      [MAX_AMOUNT, 1],
      [MAX_AMOUNT - 1, MAX_FACTOR - 1],
    ];
    for (const [a, b] of cases) {
      expect(Number.isSafeInteger(a * b)).toBe(true);
      expect(fpMul(a as Fp, b as Fp)).toBe(bigTrunc(BigInt(a) * BigInt(b), 1000n));
    }
  });

  it('fpMul совпадает с эталоном на BigInt во всём допустимом диапазоне', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -MAX_AMOUNT, max: MAX_AMOUNT }),
        fc.integer({ min: -MAX_FACTOR, max: MAX_FACTOR }),
        (a, b) => {
          expect(fpMul(a as Fp, b as Fp)).toBe(bigTrunc(BigInt(a) * BigInt(b), 1000n));
        },
      ),
    );
  });

  it('fpDiv совпадает с эталоном на BigInt', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -MAX_AMOUNT, max: MAX_AMOUNT }),
        fc.integer({ min: -MAX_FACTOR, max: MAX_FACTOR }).filter((b) => b !== 0),
        (a, b) => {
          expect(fpDiv(a as Fp, b as Fp)).toBe(bigTrunc(BigInt(a) * 1000n, BigInt(b)));
        },
      ),
    );
  });

  it('clamp ограничивает значение отрезком', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
