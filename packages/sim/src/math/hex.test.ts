import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  axialToOffset,
  distance,
  hexFromId,
  hexId,
  inBounds,
  line,
  neighbor,
  neighbors,
  offsetToAxial,
  ring,
  spiral,
  type Hex,
} from './hex.ts';

const coord = fc.integer({ min: -200, max: 200 });
const hex = fc.record({ q: coord, r: coord });
const radius = fc.integer({ min: 0, max: 30 });
const key = (h: Hex): string => `${h.q},${h.r}`;

describe('гекс-математика', () => {
  it('соседи идут в порядке SE, NE, N, NW, SW, S', () => {
    expect(neighbors({ q: 0, r: 0 })).toEqual([
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ]);
    expect(neighbor({ q: 2, r: 3 }, 5)).toEqual({ q: 2, r: 4 });
  });

  it('все соседи на расстоянии 1', () => {
    fc.assert(
      fc.property(hex, (h) => {
        for (const n of neighbors(h)) expect(distance(h, n)).toBe(1);
      }),
    );
  });

  it('расстояние симметрично и равно нулю только для совпадающих гексов', () => {
    fc.assert(
      fc.property(hex, hex, (a, b) => {
        expect(distance(a, b)).toBe(distance(b, a));
        expect(distance(a, b) === 0).toBe(a.q === b.q && a.r === b.r);
      }),
    );
  });

  it('расстояние удовлетворяет неравенству треугольника', () => {
    fc.assert(
      fc.property(hex, hex, hex, (a, b, c) => {
        expect(distance(a, c)).toBeLessThanOrEqual(distance(a, b) + distance(b, c));
      }),
    );
  });

  it('ring(r) содержит 6r разных гексов на расстоянии r', () => {
    fc.assert(
      fc.property(hex, fc.integer({ min: 1, max: 30 }), (c, r) => {
        const cells = ring(c, r);
        expect(cells).toHaveLength(6 * r);
        expect(new Set(cells.map(key)).size).toBe(6 * r);
        for (const h of cells) expect(distance(c, h)).toBe(r);
      }),
    );
  });

  it('ring(0) — сам центр', () => {
    expect(ring({ q: 3, r: -1 }, 0)).toEqual([{ q: 3, r: -1 }]);
  });

  it('spiral(r) покрывает все гексы на расстоянии ≤ r без повторов', () => {
    fc.assert(
      fc.property(hex, radius, (c, r) => {
        const cells = spiral(c, r);
        expect(cells).toHaveLength(1 + 3 * r * (r + 1));
        expect(new Set(cells.map(key)).size).toBe(cells.length);
        for (const h of cells) expect(distance(c, h)).toBeLessThanOrEqual(r);
      }),
    );
  });

  it('line — непрерывная цепочка соседей длиной distance + 1', () => {
    fc.assert(
      fc.property(hex, hex, (a, b) => {
        const cells = line(a, b);
        expect(cells).toHaveLength(distance(a, b) + 1);
        expect(cells[0]).toEqual(a);
        expect(cells.at(-1)).toEqual(b);
        for (let i = 1; i < cells.length; i += 1) {
          expect(distance(cells[i - 1] as Hex, cells[i] as Hex)).toBe(1);
        }
      }),
    );
  });

  it('line по прямой оси идёт по оси', () => {
    expect(line({ q: 0, r: 0 }, { q: 3, r: 0 })).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ]);
  });

  it('offset even-q и осевые координаты взаимно обратны', () => {
    fc.assert(
      fc.property(hex, (h) => {
        expect(offsetToAxial(axialToOffset(h))).toEqual(h);
      }),
    );
    fc.assert(
      fc.property(coord, coord, (col, row) => {
        expect(axialToOffset(offsetToAxial({ col, row }))).toEqual({ col, row });
      }),
    );
  });

  it('even-q сдвигает чётные столбцы вниз на полгекса', () => {
    expect(axialToOffset({ q: 0, r: 0 })).toEqual({ col: 0, row: 0 });
    expect(axialToOffset({ q: 1, r: 0 })).toEqual({ col: 1, row: 1 });
    expect(axialToOffset({ q: 2, r: -1 })).toEqual({ col: 2, row: 0 });
  });

  it('hexId и hexFromId взаимно обратны внутри карты', () => {
    const width = 40;
    const height = 30;
    for (let id = 0; id < width * height; id += 1) {
      const h = hexFromId(id, width);
      expect(inBounds(h, width, height)).toBe(true);
      expect(hexId(h, width)).toBe(id);
    }
    expect(inBounds({ q: -1, r: 0 }, width, height)).toBe(false);
    expect(inBounds({ q: 0, r: 30 }, width, height)).toBe(false);
  });
});
