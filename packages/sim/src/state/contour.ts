// Контур своей границы (04/T13): у каждой грани границы не больше одной следующей и одной
// предыдущей грани обхода; контур — замкнутые круги и цепочки, оборванные краем карты или водой.
// Примитивы для переноса фронта (front-follow.ts).
// GDD: docs/gdd/07-controls.md — «Линия фронта».
import {
  cornerEdges,
  cornerKey,
  edgeCorners,
  edgeDir,
  edgeHex,
  edgeNeighbors,
  edgeOf,
  edgeOther,
  flipEdge,
  isBorderEdge,
  type Corner,
  type EdgeId,
} from './edges.ts';
import type { LineGround } from './ground.ts';
import { TERRAIN } from '../map/types.ts';

const isLand = (g: LineGround, h: number): boolean =>
  h >= 0 && g.map.terrain[h] !== undefined && g.map.terrain[h] !== TERRAIN.water;

/**
 * Следующая грань контура своей границы — через конечный угол грани (между d и d+1).
 * У угла сходятся гекс h, сосед n_d (чужой) и сосед n_{d+1}: свой n_{d+1} — контур идёт по
 * грани n_{d+1} → n_d, чужой — по грани h → n_{d+1}, вода или край — контур обрывается.
 * @returns грань со своей стороны или -1
 */
export function contourNext(g: LineGround, owner: number, e: EdgeId): EdgeId {
  const h = edgeHex(e);
  const d = edgeDir(e);
  const a = edgeOther(g, edgeOf(h, d + 1));
  if (!isLand(g, a)) return -1;
  return g.hexes.owner[a] === owner ? edgeOf(a, d - 1) : edgeOf(h, d + 1);
}

/** Предыдущая грань контура — через начальный угол (между d−1 и d); обратна contourNext. */
export function contourPrev(g: LineGround, owner: number, e: EdgeId): EdgeId {
  const h = edgeHex(e);
  const d = edgeDir(e);
  const a = edgeOther(g, edgeOf(h, d - 1));
  if (!isLand(g, a)) return -1;
  return g.hexes.owner[a] === owner ? edgeOf(a, d + 1) : edgeOf(h, d - 1);
}

/** Направление обхода участка: вперёд — каждая грань входит в угол, где кончилась прошлая. */
export interface Way {
  readonly next: (e: EdgeId) => EdgeId;
  readonly back: (e: EdgeId) => EdgeId;
  /** Угол, через который грань входит в участок (0 — начальный угол грани, 1 — конечный). */
  readonly entry: 0 | 1;
}

/** Грани сходятся в углу. */
export function touches(g: LineGround, a: EdgeId, b: EdgeId): boolean {
  const keys = edgeCorners(a).map((c) => cornerKey(g, c));
  return edgeCorners(b).some((c) => keys.includes(cornerKey(g, c)));
}

/**
 * Направление обхода участка — по большинству соседних пар (участок из инструмента может идти
 * «зигзагом»); при равенстве — по первой паре, одна грань — вперёд.
 */
export function wayOf(g: LineGround, owner: number, edges: readonly EdgeId[]): Way {
  let votes = 0;
  let firstVote = 0;
  for (let i = 1; i < edges.length; i += 1) {
    const a = edges[i - 1] as EdgeId;
    const b = edges[i] as EdgeId;
    if (!touches(g, a, b)) continue;
    const end = cornerKey(g, edgeCorners(a)[1]);
    const v = edgeCorners(b).some((c) => cornerKey(g, c) === end) ? 1 : -1;
    votes += v;
    if (firstVote === 0) firstVote = v;
  }
  const next = (e: EdgeId): EdgeId => contourNext(g, owner, e);
  const prev = (e: EdgeId): EdgeId => contourPrev(g, owner, e);
  const forward = votes > 0 || (votes === 0 && firstVote >= 0);
  return forward ? { next, back: prev, entry: 0 } : { next: prev, back: next, entry: 1 };
}

/** Грань своей границы, которая входит в угол (side = entry) или выходит из него; -1 — нет. */
export function edgeAt(g: LineGround, owner: number, c: Corner, side: 0 | 1): EdgeId {
  const key = cornerKey(g, c);
  let best = -1;
  for (const e of cornerEdges(g, c)) {
    for (const x of [e, flipEdge(g, e)]) {
      if (x < 0 || !isBorderEdge(g, owner, x)) continue;
      if (cornerKey(g, edgeCorners(x)[side]) !== key) continue;
      if (best < 0 || x < best) best = x;
    }
  }
  return best;
}

/**
 * Ближайшие углы к c (по граням), у которых есть своя граница нужной стороны, прошедшая
 * фильтр: все на наименьшем расстоянии (поиск расширяется, пока не найдётся).
 * @returns грани границы у найденных углов
 */
export function nearestEnds(
  g: LineGround,
  owner: number,
  c: Corner,
  side: 0 | 1,
  accept: (e: EdgeId) => boolean,
): EdgeId[] {
  const limit = g.hexes.owner.length * 6;
  const seen = new Set<number>([cornerKey(g, c)]);
  let layer: Corner[] = [c];
  for (let depth = 1; layer.length > 0 && depth <= limit; depth += 1) {
    const next: Corner[] = [];
    const found: EdgeId[] = [];
    for (const x of layer) {
      for (const e of cornerEdges(g, x)) {
        for (const y of edgeCorners(e)) {
          const k = cornerKey(g, y);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push(y);
          const at = edgeAt(g, owner, y, side);
          if (at >= 0 && accept(at)) found.push(at);
        }
      }
    }
    if (found.length > 0) return found;
    layer = next;
  }
  return [];
}

/** Грани своей границы не дальше hops граней по углам от e (с обеих сторон грани). */
export function borderNear(g: LineGround, owner: number, e: EdgeId, hops: number): EdgeId[] {
  const seen = new Set<EdgeId>([e]);
  let layer = [e];
  const out: EdgeId[] = [];
  for (let depth = 1; depth <= hops; depth += 1) {
    const next: EdgeId[] = [];
    for (const x of layer) {
      const f = flipEdge(g, x);
      const ns = [...edgeNeighbors(g, x), ...(f >= 0 ? [f, ...edgeNeighbors(g, f)] : [])];
      for (const n of ns) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
        if (isBorderEdge(g, owner, n)) out.push(n);
      }
    }
    layer = next;
  }
  return out;
}

/**
 * Шагов по контуру от from до to; -1 — не дойти за limit шагов или путь идёт через грань из
 * blocked (на замкнутом контуре конец иначе обошёл бы круг через сам участок).
 */
export function walkDistance(
  from: EdgeId,
  to: EdgeId,
  walk: (e: EdgeId) => EdgeId,
  limit: number,
  blocked: ReadonlySet<EdgeId>,
): number {
  let x = from;
  for (let i = 0; i <= limit; i += 1) {
    if (x === to) return i;
    if (i > 0 && blocked.has(x)) return -1;
    x = walk(x);
    if (x < 0 || x === from) return -1;
  }
  return -1;
}

/** Участок от a до b по контуру; null — не дойти. */
export function walkPath(
  a: EdgeId,
  b: EdgeId,
  walk: (e: EdgeId) => EdgeId,
  limit: number,
): EdgeId[] | null {
  const out = [a];
  for (let x = a; x !== b;) {
    x = walk(x);
    if (x < 0 || x === a || out.length > limit) return null;
    out.push(x);
  }
  return out;
}

function walkAll(start: EdgeId, way: Way, limit: number): EdgeId[] {
  const out = [start];
  for (let x = way.next(start); x >= 0 && x !== start && out.length <= limit; x = way.next(x)) {
    out.push(x);
  }
  return out;
}

/**
 * Вся цепочка контура с гранью e в порядке обхода: от её начала (обрыв контура) или, на
 * замкнутом контуре, от самой e.
 */
export function chainOf(e: EdgeId, way: Way, limit: number): { edges: EdgeId[]; loop: boolean } {
  let start = e;
  for (let i = 0; i < limit; i += 1) {
    const p = way.back(start);
    if (p < 0) break;
    if (p === e) return { edges: walkAll(e, way, limit), loop: true };
    start = p;
  }
  return { edges: walkAll(start, way, limit), loop: false };
}

/**
 * Наименьшая дуга цепочки, покрывающая отмеченные грани (на замкнутом контуре — без самого
 * большого промежутка между ними), в порядке обхода.
 */
export function coverArc(
  chain: readonly EdgeId[],
  loop: boolean,
  marks: ReadonlySet<EdgeId>,
): EdgeId[] {
  const idx = chain.flatMap((e, i) => (marks.has(e) ? [i] : []));
  const lo = idx[0] ?? 0;
  const hi = idx.at(-1) ?? 0;
  if (!loop || idx.length < 2) return chain.slice(lo, hi + 1);
  let cut = idx.length - 1;
  let gap = chain.length - hi + lo;
  for (let k = 0; k + 1 < idx.length; k += 1) {
    const d = (idx[k + 1] as number) - (idx[k] as number);
    if (d > gap) {
      gap = d;
      cut = k;
    }
  }
  const from = idx[(cut + 1) % idx.length] as number;
  const to = idx[cut] as number;
  return from <= to ? chain.slice(from, to + 1) : [...chain.slice(from), ...chain.slice(0, to + 1)];
}
