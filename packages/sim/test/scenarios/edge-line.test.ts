import { describe, expect, it } from 'vitest';

import { normalizeLine, offensiveEdgePath } from '../../src/state/edge-line.ts';
import {
  cornerKey,
  cornerPath,
  edgeCorners,
  edgeOf,
  flipEdge,
  isLandEdge,
  type Corner,
  type EdgeId,
} from '../../src/state/edges.ts';
import {
  assignFront,
  assignUnits,
  at,
  city,
  createArmy,
  own,
  raw,
  scenario,
} from '../scenario/dsl.ts';

// Фронт A — столбец 2, земля B — столбцы 3–7.
const FIELD = `
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
  A1 a  a  b  b  b  b  B1
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
`;
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};
const W = 8;
const hex = (c: number, r: number): number => c + r * W;

type S = ReturnType<typeof scenario>;

function frontArmy(s: S): number {
  const id = s.unit('A', 'infantry', 300, at(0, 2));
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const army = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits([id], army));
  s.cmd('A', assignFront(army, 'B', null));
  s.runTicks(1);
  return army;
}

// Углы цепочки граней по порядку; null — соседние грани не сходятся в углу.
function cornersOf(g: S['state'], edges: readonly EdgeId[]): number[] | null {
  const [first, second] = edges;
  if (first === undefined) return [];
  const [a, b] = edgeCorners(first).map((c) => cornerKey(g, c)) as [number, number];
  const shared = (e: EdgeId, k: number): boolean =>
    edgeCorners(e).some((c) => cornerKey(g, c) === k);
  const out = second !== undefined && shared(second, a) ? [b, a] : [a, b];
  for (const e of edges.slice(1)) {
    const end = out.at(-1) as number;
    if (!shared(e, end)) return null;
    const next = edgeCorners(e)
      .map((c) => cornerKey(g, c))
      .find((k) => k !== end) as number;
    out.push(next);
  }
  return out;
}

// Путь к углу гекса (5, 2), обход вокруг гекса обратно в этот угол и путь дальше.
function loopAround(g: S['state']): { pre: EdgeId[]; ring: EdgeId[]; post: EdgeId[] } {
  const h = hex(5, 2);
  const k: Corner = { hex: h, a: 5 };
  const land = (x: EdgeId): boolean => isLandEdge(g, x);
  const pre = cornerPath(g, { hex: hex(3, 1), a: 0 }, k, land) ?? [];
  const post = cornerPath(g, k, { hex: hex(6, 4), a: 0 }, land) ?? [];
  const ring = [0, 1, 2, 3, 4, 5].map((d) => edgeOf(h, d));
  return { pre, ring, post };
}

describe('нормализация линии по граням (04/T14)', () => {
  const s = scenario(FIELD, { legend });
  const g = s.state;
  const e = edgeOf(hex(5, 1), 0);
  const f = flipEdge(g, e);

  it('одна грань с двух сторон — один EdgeId', () => {
    expect(f).toBeGreaterThanOrEqual(0);
    expect(normalizeLine(g, [e])).toEqual(normalizeLine(g, [f]));
    expect(offensiveEdgePath(g, [e, f])).toHaveLength(1);
  });

  it('путь туда и обратно по тем же граням оставляет только непройденную назад часть', () => {
    const from: Corner = { hex: hex(4, 1), a: 0 };
    const to: Corner = { hex: hex(6, 3), a: 3 };
    const path = cornerPath(g, from, to, (x) => isLandEdge(g, x)) ?? [];
    expect(path.length).toBeGreaterThan(4);
    const back = path.slice(2).reverse();
    expect(normalizeLine(g, [...path, ...back])).toEqual(normalizeLine(g, path.slice(0, 2)));
  });

  it('петля вокруг гекса вырезается, углы линии не повторяются', () => {
    const { pre, ring, post } = loopAround(g);
    const line = normalizeLine(g, [...pre, ...ring, ...post]);
    const corners = cornersOf(g, line);
    expect(corners).not.toBeNull();
    expect(new Set(corners).size).toBe(corners?.length);
    expect(line).toEqual(normalizeLine(g, [...pre, ...post]));
  });

  it('команда с одной гранью с двух сторон даёт линию из одной грани', () => {
    const t = scenario(FIELD, { legend });
    const army = frontArmy(t);
    t.cmd('A', raw({ t: 'setOffensiveLine', armyId: army, edges: [e, f] }));
    t.runTicks(1);
    const plan = t.state.plans.find((p) => p.armyId === army);
    expect(plan?.kind === 'front' ? plan.offensive?.edges : null).toHaveLength(1);
  });

  it('команда с петлёй принимается, петля вырезана молча', () => {
    const t = scenario(FIELD, { legend });
    const army = frontArmy(t);
    const { pre, ring } = loopAround(t.state);
    t.cmd('A', raw({ t: 'setOffensiveLine', armyId: army, edges: [...pre, ...ring] }));
    t.runTicks(1);
    const plan = t.state.plans.find((p) => p.armyId === army);
    const line = plan?.kind === 'front' ? (plan.offensive?.edges ?? []) : [];
    expect(t.rejections()).toEqual([]);
    expect(line.length).toBeGreaterThan(0);
    expect(line.length).toBeLessThan(pre.length + ring.length);
    const corners = cornersOf(t.state, line);
    expect(new Set(corners).size).toBe(corners?.length);
  });
});
