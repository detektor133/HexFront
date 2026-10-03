import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TERRAIN } from '../../src/map/types.ts';
import { hexFromId, hexId, inBounds, neighbors } from '../../src/math/hex.ts';
import { intDiv } from '../../src/math/int.ts';
import { planViews } from '../../src/queries/plan-view.ts';
import {
  borderEdges,
  edgeHex,
  edgeNeighbors,
  edgeOf,
  flipEdge,
  frontEdgePath,
  isBorderEdge,
  type EdgeId,
} from '../../src/state/edges.ts';
import { contourNext, contourPrev, followEdges } from '../../src/state/front-follow.ts';
import type { LineGround } from '../../src/state/ground.ts';
import { NEUTRAL } from '../../src/state/types.ts';
import { at, city, createArmy, assignUnits, drawFront, own, scenario } from '../scenario/dsl.ts';

// T13: фронт едет за границей от последнего положения — вдоль контура, без скачков.
// GDD: docs/gdd/07-controls.md — «Линия фронта».

const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

// Грань без стороны: меньшее из двух представлений.
const norm = (g: LineGround, e: EdgeId): EdgeId => {
  const f = flipEdge(g, e);
  return f >= 0 && f < e ? f : e;
};

// Соседи грани по углам с обеих её сторон.
const cornerNeighbors = (g: LineGround, e: EdgeId): EdgeId[] => {
  const f = flipEdge(g, e);
  const all = [...edgeNeighbors(g, e), ...(f >= 0 ? edgeNeighbors(g, f) : [])];
  return [...new Set(all.map((x) => norm(g, x)))];
};

/** Грани в пределах depth граней по углам от e (нормализованные) и расстояние до каждой. */
function within(g: LineGround, e: EdgeId, depth: number): Map<EdgeId, number> {
  const dist = new Map<EdgeId, number>([[norm(g, e), 0]]);
  let layer = [norm(g, e)];
  for (let d = 1; d <= depth; d += 1) {
    const next: EdgeId[] = [];
    for (const x of layer) {
      for (const n of cornerNeighbors(g, x)) {
        if (dist.has(n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    layer = next;
  }
  return dist;
}

/** Связная по углам часть своей границы, содержащая грань e (нормализованные грани). */
function borderPart(g: LineGround, owner: number, e: EdgeId): Set<EdgeId> {
  const isBorder = (x: EdgeId): boolean => {
    const f = flipEdge(g, x);
    return isBorderEdge(g, owner, x) || (f >= 0 && isBorderEdge(g, owner, f));
  };
  const part = new Set<EdgeId>([norm(g, e)]);
  const queue = [norm(g, e)];
  for (let i = 0; i < queue.length; i += 1) {
    for (const n of cornerNeighbors(g, queue[i] as EdgeId)) {
      if (part.has(n) || !isBorder(n)) continue;
      part.add(n);
      queue.push(n);
    }
  }
  return part;
}

/** Грань b на той же цепочке контура своей границы, что и a (обход в любую сторону). */
function sameChain(g: LineGround, owner: number, a: EdgeId, b: EdgeId): boolean {
  for (const walk of [contourNext, contourPrev]) {
    for (let x = walk(g, owner, a), i = 0; x >= 0 && x !== a && i < 10_000; i += 1) {
      if (x === b) return true;
      x = walk(g, owner, x);
    }
  }
  return false;
}

/** Цепочка по контуру: соседние грани сходятся в углу или лежат на разных цепочках контура. */
function isContourChain(g: LineGround, owner: number, edges: readonly EdgeId[]): boolean {
  for (let i = 1; i < edges.length; i += 1) {
    const a = edges[i - 1] as EdgeId;
    const b = edges[i] as EdgeId;
    if (!cornerNeighbors(g, a).includes(norm(g, b)) && sameChain(g, owner, a, b)) return false;
  }
  return true;
}

/** Концы кусков участка (куски — там, где соседние грани не сходятся в углу), по порядку. */
function pieceEnds(g: LineGround, edges: readonly EdgeId[]): EdgeId[] {
  const out: EdgeId[] = [];
  edges.forEach((e, i) => {
    const prev = edges[i - 1];
    const next = edges[i + 1];
    const touchesNorm = (x: EdgeId): boolean => cornerNeighbors(g, e).includes(norm(g, x));
    if (prev === undefined || !touchesNorm(prev)) out.push(e);
    if (next === undefined || !touchesNorm(next)) out.push(e);
  });
  return out;
}

/** Грани идут цепочкой: каждая следующая сходится с предыдущей в углу. */
function isChain(g: LineGround, edges: readonly EdgeId[]): boolean {
  for (let i = 1; i < edges.length; i += 1) {
    if (!cornerNeighbors(g, edges[i - 1] as EdgeId).includes(norm(g, edges[i] as EdgeId))) {
      return false;
    }
  }
  return true;
}

// Своя земля — столбцы 0–2, дальше ничья: фронт по восточным граням столбца 2.
const FIELD = `
  a  a  a  .  .  .  .  .
  a  a  a  .  .  .  .  .
  a  a  a  .  .  .  .  .
  A1 a  a  .  .  .  .  B1
  a  a  a  .  .  .  .  .
  a  a  a  .  .  .  .  .
  a  a  a  .  .  .  .  .
`;
const FW = 8;
const fhex = (c: number, r: number): number => c + r * FW;

/** Фронт по восточным граням столбца 2 со строки r0 по r1. */
function eastFront(g: LineGround, r0: number, r1: number): EdgeId[] {
  return frontEdgePath(g, 0, [edgeOf(fhex(2, r0), 1), edgeOf(fhex(2, r1), 1)]) ?? [];
}

describe('фронт едет за границей без скачков (04/T13)', () => {
  it('контур границы: следующая грань после предыдущей — та же грань, обе на границе', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(), fc.boolean()), { maxLength: 8 }), (picks) => {
        const g = scenario(FIELD, { legend }).state;
        for (const [pick, gain] of picks) {
          const options = gain ? gainOptions(g, 0) : lossOptions(g, 0);
          const x = options[pick % options.length];
          if (x !== undefined) g.hexes.owner[x] = gain ? 0 : NEUTRAL;
        }
        for (const e of borderEdges(g, 0)) {
          const n = contourNext(g, 0, e);
          const p = contourPrev(g, 0, e);
          if (n >= 0) expect([isBorderEdge(g, 0, n), contourPrev(g, 0, n)]).toEqual([true, e]);
          if (p >= 0) expect([isBorderEdge(g, 0, p), contourNext(g, 0, p)]).toEqual([true, e]);
        }
      }),
      { seed: 13, numRuns: 100 },
    );
  });

  it('два сдвига границы подряд = один сдвиг сразу к итоговой границе (столбец по частям)', () => {
    const direct = scenario(FIELD, { legend });
    const front = eastFront(direct.state, 1, 5);
    const steps = scenario(FIELD, { legend });
    for (let r = 0; r <= 2; r += 1) steps.setOwner(at(3, r), 'A');
    const once = followEdges(steps.state, 0, front);
    for (let r = 3; r <= 6; r += 1) steps.setOwner(at(3, r), 'A');
    const twice = followEdges(steps.state, 0, once);
    for (let r = 0; r <= 6; r += 1) direct.setOwner(at(3, r), 'A');
    expect(twice).toEqual(followEdges(direct.state, 0, front));
  });

  it('два сдвига подряд = один сдвиг сразу (выступ из двух гексов у конца фронта)', () => {
    const direct = scenario(FIELD, { legend });
    const front = eastFront(direct.state, 1, 5);
    const steps = scenario(FIELD, { legend });
    steps.setOwner(at(3, 1), 'A');
    const once = followEdges(steps.state, 0, front);
    steps.setOwner(at(4, 1), 'A');
    const twice = followEdges(steps.state, 0, once);
    direct.setOwner(at(3, 1), 'A');
    direct.setOwner(at(4, 1), 'A');
    expect(twice).toEqual(followEdges(direct.state, 0, front));
  });

  it('гекс у конца взят и снова потерян — фронт возвращается на прежние грани', () => {
    const s = scenario(FIELD, { legend });
    const front = eastFront(s.state, 3, 5);
    s.setOwner(at(3, 5), 'A');
    const once = followEdges(s.state, 0, front);
    s.setOwner(at(3, 5), null);
    expect(followEdges(s.state, 0, once)).toEqual(front);
  });

  it('локальность: после любого захвата уцелевшие грани на месте, цепочка, конец ≤ 2 граней', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 3, max: 6 }),
        fc.array(fc.tuple(fc.nat(), fc.boolean()), { minLength: 1, maxLength: 6 }),
        (r0, r1, picks) => {
          const s = scenario(FIELD, { legend });
          const g = s.state;
          let front = eastFront(g, r0, Math.max(r0 + 1, r1));
          for (const [pick, gain] of picks) {
            // Захват своими впереди или потеря своего гекса границы (не столицы).
            const options = gain ? gainOptions(g, 0) : lossOptions(g, 0);
            const x = options[pick % options.length];
            if (x === undefined) continue;
            const before = front;
            g.hexes.owner[x] = gain ? 0 : NEUTRAL;
            front = followEdges(g, 0, before);
            expect(front.every((e) => isBorderEdge(g, 0, e))).toBe(true);
            // (а) грани, оставшиеся на границе в той же связной части, что и фронт, не меняются;
            // оторванные (окружённый свой гекс) выпадают — фронт не уходит в другую часть.
            const kept = before.filter((e) => isBorderEdge(g, 0, e));
            const ends = [front[0], front.at(-1)].map((e) => borderPart(g, 0, e as EdgeId));
            for (const e of kept) {
              if (ends.some((p) => p.has(norm(g, e)))) expect(front).toContain(e);
            }
            // (б) непрерывная цепочка по контуру: разрыв — только между разными цепочками контура
            // (граница оборвана краем карты); без схлопывания.
            expect(isContourChain(g, 0, front)).toBe(true);
            // Граница разорвалась — конец мог остаться в другом куске; (в) — только для целой.
            const part = kept[0] === undefined ? null : borderPart(g, 0, kept[0]);
            const whole = !part || kept.every((e) => part.has(norm(g, e)));
            expect(front.length).toBeGreaterThan(1);
            // (в) конец — не дальше 2 граней от прежнего; если в 2 гранях границы нет, проверить
            // нельзя. Фронт из кусков (граница оборвана краем карты): новый конец — у одного из
            // прежних концов кусков.
            const oldEnds = pieceEnds(g, before);
            const oneToOne = oldEnds.length === 2 && pieceEnds(g, front).length === 2;
            for (const [i, now] of [front[0], front.at(-1)].entries()) {
              const olds = oneToOne ? [oldEnds[i] as EdgeId] : oldEnds;
              const nears = olds.map((o) => within(g, o, 2));
              const reachable = nears.some((n) => borderEdges(g, 0).some((b) => n.has(norm(g, b))));
              if (whole && reachable) {
                expect(nears.some((n) => n.has(norm(g, now as EdgeId)))).toBe(true);
              }
            }
          }
        },
      ),
      { seed: 13, numRuns: 300 },
    );
  });

  it('конец не уходит в другую связную часть границы (оторванный гекс рядом)', () => {
    // x = (2,0) держится за страну только через h = (2,1); h теряется — x становится островом.
    const s = scenario(
      `
      b  b  a  b
      b  b  a  b
      a  a  a  b
      A1 a  a  b
      a  a  a  B1
    `,
      { legend },
    );
    const W = 4;
    const h = 2 + 1 * W;
    const front = frontEdgePath(s.state, 0, [edgeOf(h, 1), edgeOf(2 + 4 * W, 1)]) ?? [];
    expect(front.length).toBeGreaterThan(2);
    s.setOwner(at(2, 1), 'B');
    const moved = followEdges(s.state, 0, front);
    const part = borderPart(s.state, 0, moved.at(-1) as EdgeId);
    expect(moved.every((e) => part.has(norm(s.state, e)))).toBe(true);
    expect(moved.some((e) => edgeHex(e) === 2)).toBe(false);
  });

  it('фронт из трёх граней не схлопывается, когда потерян гекс его конца', () => {
    const s = scenario(FIELD, { legend });
    const front = eastFront(s.state, 0, 1);
    expect(front).toHaveLength(3);
    s.setOwner(at(2, 1), null);
    const moved = followEdges(s.state, 0, front);
    expect(moved.length).toBeGreaterThan(1);
    expect(isChain(s.state, moved)).toBe(true);
  });

  it('фронт из нескольких граней не схлопывается в одну грань (потерян гекс фронта)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 5 }), (r, d) => {
        const s = scenario(FIELD, { legend });
        const g = s.state;
        // Две соседние восточные грани одного гекса столбца 2.
        const pair = frontEdgePath(g, 0, [edgeOf(fhex(2, r), 1), edgeOf(fhex(2, r), 0)]) ?? [];
        expect(pair.length).toBe(2);
        // Теряется гекс фронта или его сосед сзади — граница отходит.
        const lost = d % 2 === 0 ? fhex(2, r) : fhex(1, r);
        g.hexes.owner[lost] = NEUTRAL;
        if (d > 1) g.hexes.owner[fhex(2, r)] = NEUTRAL;
        const moved = followEdges(g, 0, pair);
        expect(moved.length).toBeGreaterThan(1);
        expect(isChain(g, moved)).toBe(true);
      }),
      { seed: 13 },
    );
  });

  it('середина идёт в том же направлении обхода и не уходит на другую сторону страны', () => {
    const s = scenario(
      `
      .  .  .  .  .  .  .
      .  .  .  .  .  .  .
      .  .  a  a  a  .  .
      .  .  a  A1 a  .  .
      .  .  a  a  a  .  .
      .  .  .  .  .  .  .
      .  .  .  .  .  .  B1
    `,
      { legend },
    );
    const w = s.state.map.width;
    const hx = (c: number, r: number): number => c + r * w;
    // Северная половина контура: от западной грани (2,3) через север к восточной грани (4,3).
    const front =
      frontEdgePath(s.state, 0, [edgeOf(hx(2, 3), 3), edgeOf(hx(3, 2), 2), edgeOf(hx(4, 3), 0)]) ??
      [];
    expect(front.every((e) => intDiv(edgeHex(e), w) <= 3)).toBe(true);
    // Захват на севере удлиняет северный обход — южный становится короче.
    s.setOwner(at(3, 1), 'A');
    s.setOwner(at(2, 1), 'A');
    const moved = followEdges(s.state, 0, front);
    expect(moved.every((e) => isBorderEdge(s.state, 0, e))).toBe(true);
    expect(moved.some((e) => intDiv(edgeHex(e), w) === 4)).toBe(false);
    expect(moved.some((e) => intDiv(edgeHex(e), w) <= 1)).toBe(true);
  });

  it('снимок игрока совпадает с plan.edges состояния сразу после захвата', () => {
    const s = scenario(FIELD, { legend });
    const unit = s.unit('A', 'infantry', 100, at(0, 3));
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A').at(-1)?.id ?? -1;
    s.cmd('A', assignUnits([unit], army));
    s.cmd('A', drawFront(army, [at(2, 1), at(2, 5)]));
    s.runTicks(1);
    s.capture(at(3, 2), 'A');
    const plan = s.state.plans.find((p) => p.armyId === army);
    const view = planViews(s.state, 0).find((p) => p.armyId === army);
    const edges = plan?.kind === 'front' ? plan.edges : [];
    expect(edges.every((e) => isBorderEdge(s.state, 0, e))).toBe(true);
    expect(view?.kind === 'front' ? view.edges : null).toEqual(edges);
  });
  it('выбыл сосед: его земля ничья, фронт на тех же гранях границы, снимок = plan.edges', () => {
    const s = scenario(
      `
      a  a  a  b  b
      a  a  a  b  b
      A1 a  a  b  B1
      a  a  a  b  b
      a  a  a  b  b
    `,
      { legend },
    );
    const unit = s.unit('A', 'infantry', 100, at(0, 2));
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A').at(-1)?.id ?? -1;
    s.cmd('A', assignUnits([unit], army));
    s.cmd('A', drawFront(army, [at(2, 0), at(2, 4)]));
    s.runTicks(1);
    const frontOf = (): readonly number[] => {
      const plan = s.state.plans.find((p) => p.armyId === army);
      return plan?.kind === 'front' ? plan.edges : [];
    };
    const before = frontOf();
    expect(before.length).toBeGreaterThan(1);
    // Столица B взята, отрядов у B нет — B выбывает, его гексы становятся ничьими.
    s.capture(at(4, 2), 'A');
    s.runTicks(2);
    expect(s.player('B').status).toBe('eliminated');
    expect(s.owner(at(3, 0))).toBeNull();
    // Граница с ничьей землёй — тоже фронт (07-controls.md): грани те же и все на границе.
    expect(frontOf()).toEqual(before);
    expect(frontOf().every((e) => isBorderEdge(s.state, 0, e))).toBe(true);
    const view = planViews(s.state, 0).find((p) => p.armyId === army);
    expect(view?.kind === 'front' ? view.edges : null).toEqual(frontOf());
  });
});

/** Свои гексы границы, кроме столицы, — кандидаты на потерю, по возрастанию HexId. */
function lossOptions(g: LineGround, owner: number): number[] {
  const capital = fhex(0, 3);
  return borderEdges(g, owner)
    .map(edgeHex)
    .filter((h, i, all) => h !== capital && all.indexOf(h) === i)
    .sort((a, b) => a - b);
}

/** Ничьи гексы суши рядом со своей землёй — кандидаты на захват, по возрастанию HexId. */
function gainOptions(g: LineGround, owner: number): number[] {
  const { width, height } = g.map;
  const out: number[] = [];
  g.hexes.owner.forEach((o, h) => {
    if (o === owner || g.map.terrain[h] === TERRAIN.water || o !== NEUTRAL) return;
    const near = neighbors(hexFromId(h, width)).some(
      (n) => inBounds(n, width, height) && g.hexes.owner[hexId(n, width)] === owner,
    );
    if (near) out.push(h);
  });
  return out;
}
