// Грани гексов для планов армий (CR-003): линии фронта и наступления рисуются и вводятся по граням.
// GDD: docs/gdd/07-controls.md — «Планы армий»; вид — art/units.md, «Линии планов».
import {
  TERRAIN,
  distance,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  type MapStatic,
} from '@hexfront/sim';

import { hexCenter, hexEdge, pixelToHex, type Point } from '../render/hex-geometry.ts';

/** Грань: гекс и направление (индекс в neighbors); other — сосед за гранью или -1 (край карты). */
export interface Edge {
  readonly hex: number;
  readonly d: number;
  readonly other: number;
}

export interface Ground {
  readonly map: MapStatic;
  readonly owner: ArrayLike<number>;
  readonly me: number;
}

const isLand = (map: MapStatic, h: number): boolean =>
  h >= 0 && map.terrain[h] !== undefined && map.terrain[h] !== TERRAIN.water;

function edgesOf(map: MapStatic, hex: number): Edge[] {
  return neighbors(hexFromId(hex, map.width)).map((n, d) => ({
    hex,
    d,
    other: inBounds(n, map.width, map.height) ? hexId(n, map.width) : -1,
  }));
}

/** Грань своей границы: свой гекс суши | чужая или ничья суша. */
export function isBorderEdge(g: Ground, e: Edge): boolean {
  return (
    g.owner[e.hex] === g.me &&
    isLand(g.map, e.hex) &&
    isLand(g.map, e.other) &&
    g.owner[e.other] !== g.me
  );
}

/**
 * Ближайшая к точке грань среди граней гекса под точкой и его соседей, прошедшая фильтр.
 * @returns грань или null, если подходящих граней рядом нет
 */
export function nearestEdge(
  map: MapStatic,
  radius: number,
  world: Point,
  accept: (e: Edge) => boolean,
): Edge | null {
  const h = pixelToHex(world, radius);
  if (!inBounds(h, map.width, map.height)) return null;
  const around = [h, ...neighbors(h)].filter((x) => inBounds(x, map.width, map.height));
  let best: Edge | null = null;
  let bestD = Infinity;
  for (const x of around) {
    const id = hexId(x, map.width);
    for (const e of edgesOf(map, id)) {
      if (!accept(e)) continue;
      const [a, b] = hexEdge(hexCenter(x, radius), radius, e.d);
      const d = Math.hypot((a.x + b.x) / 2 - world.x, (a.y + b.y) / 2 - world.y);
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
  }
  return best;
}

/** Грани цепочки гексов фронта, смотрящие на чужую или ничью сушу. */
export function frontEdges(g: Ground, hexes: readonly number[]): Edge[] {
  return hexes.flatMap((h) => edgesOf(g.map, h).filter((e) => isBorderEdge(g, e)));
}

/** Расстояние в гексах до ближайшего гекса набора (для «ближе к фронту / дальше от фронта»). */
export function distanceTo(map: MapStatic, hex: number, set: readonly number[]): number {
  const at = hexFromId(hex, map.width);
  let best = Infinity;
  for (const s of set) best = Math.min(best, distance(at, hexFromId(s, map.width)));
  return best;
}

/**
 * Грани линии наступления — внешняя кромка её гексов: грани к соседям не из линии, которые
 * дальше от фронта армии. Это и есть «граница, до которой наступать».
 */
export function offensiveEdges(
  map: MapStatic,
  front: readonly number[],
  line: readonly number[],
): Edge[] {
  const inLine = new Set(line);
  const out: Edge[] = [];
  for (const h of line) {
    const dh = front.length > 0 ? distanceTo(map, h, front) : 0;
    for (const e of edgesOf(map, h)) {
      if (e.other < 0 || inLine.has(e.other) || !isLand(map, e.other)) continue;
      if (front.length === 0 || distanceTo(map, e.other, front) > dh) out.push(e);
    }
  }
  return out;
}
