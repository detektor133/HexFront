import { describe, expect, it } from 'vitest';

import { borderEdges, edgeOther } from '../../src/state/edges.ts';
import { frontLinePath } from '../../src/state/front-follow.ts';
import { city, own, scenario } from '../scenario/dsl.ts';

// Своя земля с вражеским анклавом посередине и вражеским берегом справа: две разорванные цепочки
// границы. Один мазок через обе — два участка фронта, а не отказ.
const MAP = `
  A1 a  a  a  a  a  b
  a  a  a  a  a  a  b
  a  a  b  b  a  a  b
  a  a  a  a  a  a  b
  a  a  a  a  a  a  B1
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('фронт из нескольких участков одним мазком', () => {
  it('точки на двух разорванных цепочках границы дают оба участка', () => {
    const s = scenario(MAP, { legend });
    const g = { map: s.state.map, hexes: s.state.hexes };
    const width = s.state.map.width;
    const edges = borderEdges(g, 0);
    const toEnclave = edges.find((e) => edgeOther(g, e) === 2 + 2 * width);
    const toShore = edges.find((e) => edgeOther(g, e) === 6 + 1 * width);
    if (toEnclave === undefined || toShore === undefined) throw new Error('нет граней');
    const path = frontLinePath(g, 0, [toEnclave, toShore]);
    expect(path).not.toBeNull();
    expect(path).toContain(toEnclave);
    expect(path).toContain(toShore);
  });
});
