// Грани гексов на экране (CR-004): середина грани, ближайшая к пальцу грань.
// Логика граней (смежность, пути) — в sim, `state/edges.ts`.
import {
  edgeDir,
  edgeHex,
  edgeOf,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  type EdgeId,
  type MapStatic,
} from '@hexfront/sim';

import { hexCenter, hexEdge, pixelToHex, type Point } from '../render/hex-geometry.ts';

/** Концы грани в мировых координатах. */
export function edgeEnds(map: MapStatic, radius: number, e: EdgeId): [Point, Point] {
  return hexEdge(hexCenter(hexFromId(edgeHex(e), map.width), radius), radius, edgeDir(e));
}

/** Середина грани в мировых координатах. */
export function edgeMid(map: MapStatic, radius: number, e: EdgeId): Point {
  const [a, b] = edgeEnds(map, radius, e);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Ближайшая к точке грань среди граней гекса под точкой и его соседей, прошедшая фильтр.
 * @returns грань или null, если подходящих граней рядом нет
 */
export function nearestEdge(
  map: MapStatic,
  radius: number,
  world: Point,
  accept: (e: EdgeId) => boolean,
): EdgeId | null {
  const h = pixelToHex(world, radius);
  if (!inBounds(h, map.width, map.height)) return null;
  const around = [h, ...neighbors(h)].filter((x) => inBounds(x, map.width, map.height));
  let best: EdgeId | null = null;
  let bestD = Infinity;
  for (const x of around) {
    for (let d = 0; d < 6; d += 1) {
      const e = edgeOf(hexId(x, map.width), d);
      if (!accept(e)) continue;
      const m = edgeMid(map, radius, e);
      const dist = Math.hypot(m.x - world.x, m.y - world.y);
      if (dist < bestD) {
        best = e;
        bestD = dist;
      }
    }
  }
  return best;
}

/**
 * Ломаные по цепочке граней: соседние грани с общим углом идут одной ломаной, разрыв (грани не
 * сходятся) начинает новую — чтобы не рисовать отрезок через разрыв.
 * @returns ломаные в мировых координатах
 */
export function edgeRuns(map: MapStatic, radius: number, edges: readonly EdgeId[]): Point[][] {
  const runs: Point[][] = [];
  const same = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) < radius * 0.05;
  for (let i = 0; i < edges.length; i += 1) {
    const [a, b] = edgeEnds(map, radius, edges[i] as EdgeId);
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && same(last, a)) run.push(b);
    else if (run && last && same(last, b)) run.push(a);
    else if (run && run.length === 2 && run[0] && (same(run[0], a) || same(run[0], b))) {
      // Вторая грань сходится с началом первой — разворачиваем первую.
      run.reverse();
      run.push(same(run.at(-1) as Point, a) ? b : a);
    } else runs.push([a, b]);
  }
  return runs;
}
