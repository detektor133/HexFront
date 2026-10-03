// Путь по углам гексов, ближайший к траектории пальца (07-controls.md, «Линия наступления»):
// из кратчайших путей между углами — с наименьшей суммой расстояний углов до отрезка, который
// прошёл палец; при равенстве — меньший EdgeId.
import {
  canonicalEdge,
  cornerEdges,
  cornerKey,
  edgeCorners,
  type Corner,
  type EdgeId,
  type MapStatic,
} from '@hexfront/sim';

import { cornerPoint } from './plan-edges.ts';
import type { Point } from '../render/hex-geometry.ts';

/** Суммы расстояний ближе этого (px мира) считаются равными — решает меньший EdgeId. */
const TIE_EPS = 1e-6;

type Ground = { map: MapStatic; hexes: { owner: Int16Array } };

interface Best {
  readonly cost: number;
  readonly edges: EdgeId[];
}

function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Лучше ли путь x пути y: меньше сумма, при равенстве — меньший EdgeId (по порядку граней).
function better(x: Best, y: Best | undefined): boolean {
  if (!y) return true;
  if (Math.abs(x.cost - y.cost) > TIE_EPS) return x.cost < y.cost;
  for (let i = 0; i < x.edges.length; i += 1) {
    const a = x.edges[i] as EdgeId;
    const b = y.edges[i] as EdgeId;
    if (a !== b) return a < b;
  }
  return false;
}

/**
 * Путь по углам гексов от угла from до угла to, ближайший к отрезку траектории пальца [a, b].
 * @returns грани по порядку (к одному EdgeId) или null, если не дойти
 */
export function trajectoryPath(
  g: Ground,
  radius: number,
  from: Corner,
  to: Corner,
  seg: readonly [Point, Point],
  accept: (e: EdgeId) => boolean,
): EdgeId[] | null {
  const target = cornerKey(g, to);
  const start = cornerKey(g, from);
  if (start === target) return [];
  const cost = (c: Corner): number => toSegment(cornerPoint(g.map, radius, c), seg[0], seg[1]);
  // Обход слоями: лучший путь в угол слоя k+1 — из лучших путей в углы слоя k.
  const best = new Map<number, Best>([[start, { cost: 0, edges: [] }]]);
  let layer: Corner[] = [from];
  const limit = g.hexes.owner.length * 6;
  for (let step = 0; step < limit && layer.length > 0 && !best.has(target); step += 1) {
    const next = new Map<number, { corner: Corner; best: Best }>();
    for (const c of layer) {
      const ck = cornerKey(g, c);
      const here = best.get(ck) as Best;
      for (const e of cornerEdges(g, c)) {
        if (!accept(e)) continue;
        const [x, y] = edgeCorners(e);
        const n = cornerKey(g, x) === ck ? y : x;
        const nk = cornerKey(g, n);
        if (best.has(nk)) continue;
        const cand = { cost: here.cost + cost(n), edges: [...here.edges, canonicalEdge(g, e)] };
        if (better(cand, next.get(nk)?.best)) next.set(nk, { corner: n, best: cand });
      }
    }
    layer = [];
    for (const [k, v] of [...next].sort((p, q) => p[0] - q[0])) {
      best.set(k, v.best);
      layer.push(v.corner);
    }
  }
  return best.get(target)?.edges ?? null;
}
