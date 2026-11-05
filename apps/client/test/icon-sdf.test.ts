import { describe, expect, it } from 'vitest';

import { signedDistanceField } from '../src/render/icon-sdf.ts';

describe('поле расстояний иконки', () => {
  const size = 32;
  const square = new Uint8Array(size * size);
  for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) square[y * size + x] = 1;
  const field = signedDistanceField(square, size, 8, 1);
  const at = (x: number, y: number): number => field[y * size + x] ?? 0;

  it('внутри фигуры больше 128, снаружи меньше, на краю около 128', () => {
    expect(at(16, 16)).toBeGreaterThan(200);
    expect(at(1, 1)).toBeLessThan(40);
    expect(Math.abs(at(8, 16) - 128)).toBeLessThan(12);
    expect(Math.abs(at(7, 16) - 128)).toBeLessThan(12);
  });

  it('значение растёт к центру и вне spread не меняется', () => {
    expect(at(10, 16)).toBeGreaterThan(at(8, 16));
    const narrow = signedDistanceField(square, size, 4, 1);
    expect(narrow[16 * size]).toBe(narrow[16 * size + 2]);
  });

  it('уменьшение вдвое даёт то же поле в клетках результата', () => {
    const half = signedDistanceField(square, size, 4, 2);
    expect(half.length).toBe((size / 2) ** 2);
    expect(half[8 * (size / 2) + 8]).toBeGreaterThan(200);
  });
});
