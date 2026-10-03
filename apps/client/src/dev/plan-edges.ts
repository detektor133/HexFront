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
  type Corner,
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

/** Точка угла гекса (между направлениями a и a+1) в мировых координатах. */
export function cornerPoint(map: MapStatic, radius: number, c: Corner): Point {
  const [a, b] = edgeEnds(map, radius, edgeOf(c.hex, c.a));
  const [p, q] = edgeEnds(map, radius, edgeOf(c.hex, c.a + 1));
  const same = (x: Point, y: Point): boolean => Math.hypot(x.x - y.x, x.y - y.y) < radius * 0.05;
  return same(a, p) || same(a, q) ? a : b;
}

/** Ближайший к точке угол гекса под ней (или null за картой). */
export function nearestCorner(map: MapStatic, radius: number, world: Point): Corner | null {
  const h = pixelToHex(world, radius);
  if (!inBounds(h, map.width, map.height)) return null;
  const hex = hexId(h, map.width);
  let best: Corner | null = null;
  let bestD = Infinity;
  for (let a = 0; a < 6; a += 1) {
    const p = cornerPoint(map, radius, { hex, a });
    const d = Math.hypot(p.x - world.x, p.y - world.y);
    if (d < bestD) {
      best = { hex, a };
      bestD = d;
    }
  }
  return best;
}

/**
 * Сглаживание ломаной (Чайкин): углы срезаются, концы остаются на месте — линия наступления
 * выглядит проведённой рукой, как в HoI4, но идёт по граням.
 * @returns новая ломаная
 */
export function smooth(pts: readonly Point[], rounds = 2): Point[] {
  let cur = [...pts];
  for (let k = 0; k < rounds && cur.length > 2; k += 1) {
    const next: Point[] = [cur[0] as Point];
    for (let i = 0; i < cur.length - 1; i += 1) {
      const a = cur[i] as Point;
      const b = cur[i + 1] as Point;
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(cur[cur.length - 1] as Point);
    cur = next;
  }
  return cur;
}
