// Грани гексов (CR-004): линия фронта и линия наступления задаются гранями, а не гексами, как в
// HoI4 — можно взять одну грань гекса. Грань — направленная: EdgeId = hex × 6 + d, где d — индекс
// направления в DIRECTIONS; та же грань со стороны соседа — flipEdge.
// GDD: docs/gdd/07-controls.md — «Планы армий».
import type { LineGround } from './ground.ts';
import { TERRAIN } from '../map/types.ts';
import {
  distance,
  hexFromId,
  hexId,
  inBounds,
  neighbor,
  type Direction,
  type HexId,
} from '../math/hex.ts';
import { intDiv } from '../math/int.ts';

/** Грань: hex × 6 + d (d — направление к соседу). */
export type EdgeId = number;

const SIDES = 6;

export const edgeOf = (hex: HexId, d: number): EdgeId =>
  hex * SIDES + (((d % SIDES) + SIDES) % SIDES);
export const edgeHex = (e: EdgeId): HexId => intDiv(e, SIDES);
export const edgeDir = (e: EdgeId): number => e - edgeHex(e) * SIDES;

/** Сосед за гранью или -1 (край карты). */
export function edgeOther(g: LineGround, e: EdgeId): HexId {
  const { width, height } = g.map;
  const n = neighbor(hexFromId(edgeHex(e), width), edgeDir(e) as Direction);
  return inBounds(n, width, height) ? hexId(n, width) : -1;
}

/** Та же грань со стороны соседа или -1. */
export function flipEdge(g: LineGround, e: EdgeId): EdgeId {
  const other = edgeOther(g, e);
  return other < 0 ? -1 : edgeOf(other, edgeDir(e) + 3);
}

const isLand = (g: LineGround, h: HexId): boolean =>
  h >= 0 && g.map.terrain[h] !== undefined && g.map.terrain[h] !== TERRAIN.water;

/** Грань суши с обеих сторон (по ней можно провести линию наступления). */
export function isLandEdge(g: LineGround, e: EdgeId): boolean {
  return isLand(g, edgeHex(e)) && isLand(g, edgeOther(g, e));
}

/** Грань своей границы: со своей стороны свой гекс суши, с другой — чужая или ничья суша. */
export function isBorderEdge(g: LineGround, owner: number, e: EdgeId): boolean {
  const other = edgeOther(g, e);
  return (
    g.hexes.owner[edgeHex(e)] === owner &&
    isLand(g, edgeHex(e)) &&
    isLand(g, other) &&
    g.hexes.owner[other] !== owner
  );
}

/**
 * Грани, сходящиеся с e в её углах (по одной-две на угол). У угла между направлениями a и a+1
 * гекса h три грани: (h, a), (h, a+1) и грань между соседями n_a → n_{a+1} = (n_a, a+2).
 * @returns направленные грани (со стороны того гекса, из которого они получены)
 */
export function edgeNeighbors(g: LineGround, e: EdgeId): EdgeId[] {
  const h = edgeHex(e);
  const d = edgeDir(e);
  const out: EdgeId[] = [edgeOf(h, d - 1), edgeOf(h, d + 1)];
  for (const a of [d - 1, d]) {
    const na = edgeOther(g, edgeOf(h, a));
    if (na >= 0) out.push(edgeOf(na, a + 2));
  }
  return out;
}

/** Своя граница: грань, приведённая к своей стороне, или -1. */
function ownSide(g: LineGround, owner: number, e: EdgeId): EdgeId {
  if (isBorderEdge(g, owner, e)) return e;
  const f = flipEdge(g, e);
  return f >= 0 && isBorderEdge(g, owner, f) ? f : -1;
}

/** Соседние грани своей границы (со своей стороны). */
function borderNeighbors(g: LineGround, owner: number, e: EdgeId): EdgeId[] {
  const out: EdgeId[] = [];
  for (const n of edgeNeighbors(g, e)) {
    const s = ownSide(g, owner, n);
    if (s >= 0 && !out.includes(s)) out.push(s);
  }
  return out.sort((a, b) => a - b);
}

// Кратчайший путь по графу граней (ничьи — по меньшему EdgeId), без начала; null — не дойти.
function bfs(
  from: EdgeId,
  to: EdgeId,
  next: (e: EdgeId) => EdgeId[],
  limit: number,
): EdgeId[] | null {
  const prev = new Map<EdgeId, EdgeId>([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !prev.has(to) && i < limit; i += 1) {
    const e = queue[i] as EdgeId;
    for (const n of next(e)) {
      if (prev.has(n)) continue;
      prev.set(n, e);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return null;
  const out: EdgeId[] = [];
  for (let e = to; e !== from; e = prev.get(e) as EdgeId) out.push(e);
  return out.reverse();
}

// Цепочка граней через точки: между соседними точками — кратчайший путь по next.
function chain(
  points: readonly EdgeId[],
  next: (e: EdgeId) => EdgeId[],
  limit: number,
  strict: boolean,
): EdgeId[] | null {
  const [start] = points;
  if (start === undefined) return null;
  const out: EdgeId[] = [start];
  const seen = new Set(out);
  for (let i = 1; i < points.length; i += 1) {
    const to = points[i] as EdgeId;
    if (seen.has(to)) continue;
    const path = bfs(out[out.length - 1] as EdgeId, to, next, limit);
    if (!path && strict) return null;
    for (const e of path ?? [to]) {
      if (seen.has(e)) continue;
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

/** Предел обхода при поиске пути по граням — вся карта, 6 граней на гекс. */
const limitOf = (g: LineGround): number => g.hexes.owner.length * SIDES;

/**
 * Участок фронта по точкам-граням своей границы: между точками — кратчайший путь по граням
 * границы (сходящимся в углах).
 * @returns грани по порядку (со своей стороны) или null, если точки не на границе или не соединить
 */
export function frontEdgePath(
  g: LineGround,
  owner: number,
  points: readonly EdgeId[],
): EdgeId[] | null {
  const own = points.map((e) => ownSide(g, owner, e));
  if (own.length === 0 || own.some((e) => e < 0)) return null;
  return chain(own, (e) => borderNeighbors(g, owner, e), limitOf(g), true);
}

/**
 * Линия наступления по точкам-граням: между точками — кратчайший путь по граням суши.
 * @returns грани по порядку или null, если точки не на суше или их не соединить
 */
export function landEdgePath(g: LineGround, points: readonly EdgeId[]): EdgeId[] | null {
  if (points.length === 0 || points.some((e) => !isLandEdge(g, e))) return null;
  const next = (e: EdgeId): EdgeId[] =>
    edgeNeighbors(g, e)
      .filter((n) => isLandEdge(g, n))
      .sort((a, b) => a - b);
  return chain(points, next, limitOf(g), true);
}

/**
 * Непрерывный кусок своей границы с игроком enemy, содержащий грань e: связные по углам грани,
 * за которыми — enemy. Оторванные куски той же границы не входят.
 * @returns грани по порядку вдоль границы; пусто, если e не на границе с enemy
 */
export function borderSegmentEdges(
  g: LineGround,
  owner: number,
  enemy: number,
  e: EdgeId,
): EdgeId[] {
  const s = ownSide(g, owner, e);
  const facing = (x: EdgeId): boolean => g.hexes.owner[edgeOther(g, x)] === enemy;
  if (s < 0 || !facing(s)) return [];
  const next = (x: EdgeId): EdgeId[] => borderNeighbors(g, owner, x).filter(facing);
  const comp = new Set<EdgeId>([s]);
  const queue = [s];
  for (let i = 0; i < queue.length; i += 1) {
    for (const n of next(queue[i] as EdgeId)) {
      if (comp.has(n)) continue;
      comp.add(n);
      queue.push(n);
    }
  }
  // Порядок: обход в глубину от «конца» (грань с наименьшим числом соседей в куске).
  const all = [...comp].sort((a, b) => a - b);
  const start = [...all].sort((a, b) => next(a).length - next(b).length || a - b)[0] as EdgeId;
  const out: EdgeId[] = [];
  const visited = new Set<EdgeId>();
  const stack = [start];
  while (stack.length > 0) {
    const x = stack.pop() as EdgeId;
    if (visited.has(x)) continue;
    visited.add(x);
    out.push(x);
    for (const n of next(x).reverse()) if (!visited.has(n)) stack.push(n);
  }
  return out;
}

/** Все грани своей границы, по возрастанию. */
export function borderEdges(g: LineGround, owner: number): EdgeId[] {
  const out: EdgeId[] = [];
  g.hexes.owner.forEach((o, h) => {
    if (o !== owner) return;
    for (let d = 0; d < SIDES; d += 1)
      if (isBorderEdge(g, owner, edgeOf(h, d))) out.push(edgeOf(h, d));
  });
  return out;
}

/**
 * Фронт едет за границей: если какая-то грань участка перестала быть своей границей, концы
 * участка переносятся на ближайшие грани границы (по гексу, при равенстве — то же направление,
 * затем меньший EdgeId), а середина заново идёт кратчайшим путём по граням границы между ними.
 * Переносятся только концы — иначе участок при каждом сдвиге копил бы грани и обрастал страну.
 * Нет границы — грани не меняются.
 * @returns новые грани по порядку
 */
export function followEdges(g: LineGround, owner: number, edges: readonly EdgeId[]): EdgeId[] {
  if (edges.every((e) => isBorderEdge(g, owner, e))) return [...edges];
  const border = borderEdges(g, owner);
  const first = edges[0];
  const last = edges.at(-1);
  if (border.length === 0 || first === undefined || last === undefined) return [...edges];
  const { width } = g.map;
  const snap = (e: EdgeId): EdgeId => {
    if (isBorderEdge(g, owner, e)) return e;
    const at = hexFromId(edgeHex(e), width);
    let best = e;
    let bestKey = Number.MAX_SAFE_INTEGER;
    for (const b of border) {
      const key =
        distance(at, hexFromId(edgeHex(b), width)) * 16 + (edgeDir(b) === edgeDir(e) ? 0 : 8);
      if (key < bestKey || (key === bestKey && b < best)) {
        best = b;
        bestKey = key;
      }
    }
    return best;
  };
  const a = snap(first);
  const b = snap(last);
  if (a === b) return [a];
  return chain([a, b], (x) => borderNeighbors(g, owner, x), limitOf(g), false) ?? [a, b];
}

/** Гексы граней по порядку, без повторов (со своей стороны грани). */
export function edgeHexes(edges: readonly EdgeId[]): HexId[] {
  const out: HexId[] = [];
  for (const e of edges) if (!out.includes(edgeHex(e))) out.push(edgeHex(e));
  return out;
}

/**
 * Угол гекса: между направлениями a и a+1 гекса hex. Один и тот же угол принадлежит трём
 * гексам; cornerKey у всех трёх представлений одинаковый.
 */
export interface Corner {
  readonly hex: HexId;
  readonly a: number;
}

/** Сдвиг и основание ключа угла: сумма осевых координат трёх гексов угла — целая пара. */
const KEY_OFFSET = 1 << 12;
const KEY_SPAN = 1 << 14;

/** Ключ угла: сумма осевых координат трёх сходящихся в нём гексов (включая гексы за краем). */
export function cornerKey(g: LineGround, c: Corner): number {
  const h = hexFromId(c.hex, g.map.width);
  const na = neighbor(h, (((c.a % SIDES) + SIDES) % SIDES) as Direction);
  const nb = neighbor(h, ((((c.a + 1) % SIDES) + SIDES) % SIDES) as Direction);
  const q = h.q + na.q + nb.q;
  const r = h.r + na.r + nb.r;
  return (q + KEY_OFFSET) * KEY_SPAN + (r + KEY_OFFSET);
}

/** Углы грани: начало (между d−1 и d) и конец (между d и d+1). */
export function edgeCorners(e: EdgeId): [Corner, Corner] {
  const h = edgeHex(e);
  const d = edgeDir(e);
  return [
    { hex: h, a: (d + SIDES - 1) % SIDES },
    { hex: h, a: d },
  ];
}

/** Грани, сходящиеся в углу: (h, a), (h, a+1) и грань между соседями n_a → n_{a+1}. */
function cornerEdges(g: LineGround, c: Corner): EdgeId[] {
  const out = [edgeOf(c.hex, c.a), edgeOf(c.hex, c.a + 1)];
  const na = edgeOther(g, edgeOf(c.hex, c.a));
  if (na >= 0) out.push(edgeOf(na, c.a + 2));
  return out;
}

/**
 * Путь по углам гексов: цепочка граней без ответвлений от угла from до угла to, только по
 * граням, прошедшим фильтр (ничьи — по меньшему EdgeId).
 * @returns грани по порядку или null, если не дойти
 */
export function cornerPath(
  g: LineGround,
  from: Corner,
  to: Corner,
  accept: (e: EdgeId) => boolean,
): EdgeId[] | null {
  const target = cornerKey(g, to);
  const start = cornerKey(g, from);
  if (start === target) return [];
  const prev = new Map<number, { key: number; edge: EdgeId }>();
  const seen = new Set<number>([start]);
  const queue: Corner[] = [from];
  const limit = limitOf(g);
  for (let i = 0; i < queue.length && i < limit && !seen.has(target); i += 1) {
    const c = queue[i] as Corner;
    const ck = cornerKey(g, c);
    for (const e of cornerEdges(g, c).sort((x, y) => x - y)) {
      if (!accept(e)) continue;
      const [a, b] = edgeCorners(e);
      const next = cornerKey(g, a) === ck ? b : a;
      const nk = cornerKey(g, next);
      if (seen.has(nk)) continue;
      seen.add(nk);
      prev.set(nk, { key: ck, edge: e });
      queue.push(next);
    }
  }
  if (!seen.has(target)) return null;
  const out: EdgeId[] = [];
  for (let k = target; k !== start;) {
    const step = prev.get(k) as { key: number; edge: EdgeId };
    out.push(step.edge);
    k = step.key;
  }
  return out.reverse();
}
