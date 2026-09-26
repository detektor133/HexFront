import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { intDiv } from '../../src/math/int.ts';
import {
  borderSegmentEdges,
  edgeHex,
  edgeNeighbors,
  edgeOf,
  edgeOther,
  flipEdge,
  followEdges,
  frontEdgePath,
  isBorderEdge,
  landEdgePath,
} from '../../src/state/edges.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

// A — столбцы 0–1, B — столбец 3 (два куска: строки 0–1 и 3–4), ничья земля — столбец 2.
const MAP = `
  a  a  .  b  b
  a  a  .  b  b
  A1 a  .  .  B1
  a  a  .  b  b
  a  a  .  b  b
`;
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};
const W = 5;
const hex = (c: number, r: number): number => c + r * W;

describe('грани гексов (CR-004)', () => {
  const s = scenario(MAP, { legend });
  const g = s.state;

  it('грань со стороны соседа — та же грань: flip(flip(e)) = e, соседи грани взаимны', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: W * 5 * 6 - 1 }), (e) => {
        const f = flipEdge(g, e);
        if (f < 0) return;
        expect(flipEdge(g, f)).toBe(e);
        expect(edgeOther(g, f)).toBe(edgeHex(e));
        // У каждой грани 4 соседние грани по углам (внутри карты), и соседство взаимно с точностью до стороны.
        for (const n of edgeNeighbors(g, e)) {
          const back = edgeNeighbors(g, n).flatMap((x) => [x, flipEdge(g, x)]);
          expect(back.includes(e) || back.includes(f)).toBe(true);
        }
      }),
    );
  });

  it('фронт по двум граням соединяется цепочкой граней границы через углы', () => {
    const a = edgeOf(hex(1, 0), 0);
    const b = edgeOf(hex(1, 4), 0);
    expect(isBorderEdge(g, 0, a) && isBorderEdge(g, 0, b)).toBe(true);
    const path = frontEdgePath(g, 0, [a, b]) ?? [];
    expect(path[0]).toBe(a);
    expect(path.at(-1)).toBe(b);
    expect(path.every((e) => isBorderEdge(g, 0, e))).toBe(true);
    for (let i = 1; i < path.length; i += 1) {
      const ns = edgeNeighbors(g, path[i - 1] as number).flatMap((x) => [x, flipEdge(g, x)]);
      expect(ns).toContain(path[i]);
    }
  });

  it('грань не на своей границе — фронт не строится', () => {
    expect(frontEdgePath(g, 0, [edgeOf(hex(0, 2), 0)])).toBeNull();
  });

  it('кусок границы с врагом — только непрерывный, оторванный кусок не берётся', () => {
    const t = scenario(
      `
      a  b  .
      a  b  .
      A1 .  .
      a  b  .
      a  b  B1
    `,
      { legend },
    );
    const e = edgeOf(0, 0);
    const seg = borderSegmentEdges(t.state, 0, 1, e);
    const rows = new Set(seg.map((x) => intDiv(edgeHex(x), 3)));
    expect(seg.length).toBeGreaterThan(0);
    expect([...rows].every((r) => r <= 2)).toBe(true);
    expect(seg.every((x) => t.state.hexes.owner[edgeOther(t.state, x)] === 1)).toBe(true);
  });

  it('линия наступления по граням суши соединяет точки', () => {
    const path = landEdgePath(g, [edgeOf(hex(2, 0), 0), edgeOf(hex(2, 3), 0)]) ?? [];
    expect(path.length).toBeGreaterThan(1);
  });

  it('фронт едет за границей: после захвата столбца 2 грани встают на новую границу', () => {
    const t = scenario(MAP, { legend });
    const front = frontEdgePath(t.state, 0, [edgeOf(hex(1, 0), 0), edgeOf(hex(1, 4), 0)]) ?? [];
    for (let r = 0; r < 5; r += 1) t.setOwner(at(2, r), 'A');
    const moved = followEdges(t.state, 0, front);
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((e) => isBorderEdge(t.state, 0, e))).toBe(true);
    expect(moved.every((e) => edgeHex(e) % W === 2)).toBe(true);
  });
});
