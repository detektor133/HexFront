import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { contourNext, contourPrev } from '../../src/state/contour.ts';
import { cornerKey, edgeCorners, isBorderEdge, type EdgeId } from '../../src/state/edges.ts';
import { assignUnits, at, city, createArmy, own, raw, scenario } from '../scenario/dsl.ts';

// Земля A с выемкой (вогнутые углы границы у (2, 2)) против земли B.
const MAP = `
  a  a  a  b  b  b
  a  a  a  b  b  b
  A1 a  b  b  b  b
  a  a  a  b  b  b
  a  a  a  b  b  B1
`;
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

type S = ReturnType<typeof scenario>;

// Участок контура своей границы (с врагом) по обходу — от первой грани.
function contour(s: S): EdgeId[] {
  const g = s.state;
  let first = -1;
  for (let h = 0; h < g.hexes.owner.length && first < 0; h += 1) {
    for (let d = 0; d < 6 && first < 0; d += 1)
      if (isBorderEdge(g, 0, h * 6 + d)) first = h * 6 + d;
  }
  // Граница упирается в края карты: сначала назад к началу цепочки, затем вперёд.
  let start = first;
  for (let e = contourPrev(g, 0, start); e >= 0 && e !== first; e = contourPrev(g, 0, e)) start = e;
  const out: EdgeId[] = [start];
  for (let e = contourNext(g, 0, start); e >= 0 && e !== start; e = contourNext(g, 0, e)) {
    out.push(e);
  }
  return out;
}

// Углы цепочки по порядку; null — соседние грани не сходятся в углу.
function cornersOf(s: S, edges: readonly EdgeId[]): number[] | null {
  const key = (e: EdgeId): number[] => edgeCorners(e).map((c) => cornerKey(s.state, c));
  const [first, second] = edges;
  if (first === undefined) return [];
  const [a, b] = key(first) as [number, number];
  const out = second !== undefined && key(second).includes(a) ? [b, a] : [a, b];
  for (const e of edges.slice(1)) {
    const end = out.at(-1) as number;
    if (!key(e).includes(end)) return null;
    out.push(key(e).find((k) => k !== end) as number);
  }
  return out;
}

function front(s: S, points: readonly EdgeId[]): EdgeId[] {
  const id = s.unit('A', 'infantry', 100, at(0, 2));
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const army = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits([id], army));
  s.cmd('A', raw({ t: 'assignFront', armyId: army, edges: points }));
  s.runTicks(1);
  const plan = s.state.plans.find((p) => p.armyId === army);
  return plan?.kind === 'front' ? [...plan.edges] : [];
}

describe('нормализация граней фронта (04/T14a)', () => {
  it('росчерк из середины влево и обратно вправо — цепочка без «зигзага»', () => {
    const c = contour(scenario(MAP, { legend }));
    expect(c.length).toBeGreaterThan(6);
    const [e0, , e2, e3] = c as [EdgeId, EdgeId, EdgeId, EdgeId];
    const s = scenario(MAP, { legend });
    const edges = front(s, [e2, e0, e3]);
    const corners = cornersOf(s, edges);
    expect(corners).not.toBeNull();
    expect(new Set(corners).size).toBe(corners?.length);
    expect([...edges].sort((a, b) => a - b)).toEqual(c.slice(0, 4).sort((a, b) => a - b));
  });

  it('через вогнутые углы выемки — соседние грани сходятся в углу, углы не повторяются', () => {
    const c = contour(scenario(MAP, { legend }));
    fc.assert(
      fc.property(fc.array(fc.nat(c.length - 1), { minLength: 1, maxLength: 6 }), (idx) => {
        const s = scenario(MAP, { legend });
        const edges = front(
          s,
          idx.map((i) => c[i] as EdgeId),
        );
        expect(edges.length).toBeGreaterThan(0);
        const corners = cornersOf(s, edges);
        expect(corners).not.toBeNull();
        expect(new Set(corners).size).toBe(corners?.length);
        for (const i of idx) expect(edges).toContain(c[i]);
      }),
      { numRuns: 60, seed: 3 },
    );
  });

  it('команда с одной гранью дважды — одна грань', () => {
    const c = contour(scenario(MAP, { legend }));
    const s = scenario(MAP, { legend });
    expect(front(s, [c[2] as EdgeId, c[2] as EdgeId])).toEqual([c[2]]);
  });
});
