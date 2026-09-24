import { describe, expect, it } from 'vitest';

import { hexFromId, neighbors, offsetToAxial } from '@hexfront/sim';

import { hexCenter, hexEdge, mapBounds, pixelToHex } from '../src/render/hex-geometry.ts';

const R = 20;

describe('геометрия flat-top гексов', () => {
  it('ребро в направлении d лежит посередине между центрами соседей', () => {
    const c = { q: 3, r: 2 };
    neighbors(c).forEach((n, d) => {
      const [a, b] = hexEdge(hexCenter(c, R), R, d);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p = hexCenter(c, R);
      const q = hexCenter(n, R);
      expect(mid.x).toBeCloseTo((p.x + q.x) / 2, 6);
      expect(mid.y).toBeCloseTo((p.y + q.y) / 2, 6);
    });
  });

  it('направления 0–5 — это SE, NE, N, NW, SW, S на экране', () => {
    const o = hexCenter({ q: 0, r: 0 }, R);
    const dirs = neighbors({ q: 0, r: 0 }).map((n) => hexCenter(n, R));
    const sign = dirs.map((p) => [
      Math.sign(Math.round(p.x - o.x)),
      Math.sign(Math.round(p.y - o.y)),
    ]);
    expect(sign).toEqual([
      [1, 1],
      [1, -1],
      [0, -1],
      [-1, -1],
      [-1, 1],
      [0, 1],
    ]);
  });

  it('границы карты охватывают все гексы', () => {
    const b = mapBounds(40, 30, R);
    for (let id = 0; id < 40 * 30; id += 1) {
      const p = hexCenter(hexFromId(id, 40), R);
      expect(p.x - R).toBeGreaterThanOrEqual(b.x - 1e-9);
      expect(p.x + R).toBeLessThanOrEqual(b.x + b.width + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(b.y);
      expect(p.y).toBeLessThanOrEqual(b.y + b.height);
    }
    expect(hexCenter(offsetToAxial({ col: 1, row: 0 }), R).y - (R * Math.sqrt(3)) / 2).toBeCloseTo(
      b.y,
      6,
    );
  });

  it('pixelToHex обратна hexCenter и попадает в гекс у края', () => {
    for (let q = -4; q <= 4; q += 1) {
      for (let r = -4; r <= 4; r += 1) {
        const c = hexCenter({ q, r }, R);
        expect(pixelToHex(c, R)).toEqual({ q, r });
        expect(pixelToHex({ x: c.x + R * 0.8, y: c.y }, R)).toEqual({ q, r });
      }
    }
  });
});
