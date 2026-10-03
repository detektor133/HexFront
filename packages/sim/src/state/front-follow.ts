// Фронт едет за границей (04/T13): от последнего положения, вдоль контура своей границы.
// Грани, оставшиеся на границе, сохраняются. Пропавший конец держится за свой внешний угол:
// угол на границе — конец на месте; ушёл — конец переезжает на ближайшую грань границы (не дальше
// 2 граней, если есть) в той же связной части. Середина идёт по контуру в прежнем направлении
// обхода, а не кратчайшим путём; участок не схлопывается.
// GDD: docs/gdd/07-controls.md — «Линия фронта».
import {
  borderNear,
  chainOf,
  coverArc,
  edgeAt,
  nearestEnds,
  touches,
  walkDistance,
  walkPath,
  wayOf,
  type Way,
} from './contour.ts';
import {
  edgeCorners,
  edgeHex,
  frontEdgePath,
  isBorderEdge,
  type Corner,
  type EdgeId,
} from './edges.ts';
import type { LineGround } from './ground.ts';
import { TERRAIN } from '../map/types.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';

export { contourNext, contourPrev } from './contour.ts';

/** За один перенос конец уходит не дальше чем на столько граней, если там есть граница. */
const SNAP_HOPS = 2;

// Грани участка связны между собой по углам (порядок в списке не важен).
function connected(g: LineGround, edges: readonly EdgeId[]): boolean {
  const [first] = edges;
  if (first === undefined) return true;
  const seen = new Set<EdgeId>([first]);
  const queue = [first];
  for (let i = 0; i < queue.length; i += 1) {
    for (const e of edges) {
      if (seen.has(e) || !touches(g, queue[i] as EdgeId, e)) continue;
      seen.add(e);
      queue.push(e);
    }
  }
  return seen.size === new Set(edges).size;
}

/**
 * Уцелевшие грани в одном связном куске своей земли: в куске со столицей, если там есть хоть одна
 * (оторванный от страны карман выпадает, даже если граней на нём больше, — иначе фронт уходил на
 * карман и замыкался вокруг него, 04/T18); нет — в куске, где таких граней больше всего (при
 * равенстве — где раньше первая): фронт на своём острове за водой остаётся там.
 */
function mainPart(g: LineGround, owner: number, kept: readonly EdgeId[], capital: HexId): EdgeId[] {
  const { width, height } = g.map;
  const own = (h: number): boolean =>
    g.hexes.owner[h] === owner && g.map.terrain[h] !== TERRAIN.water;
  let best: EdgeId[] = [];
  const done = new Set<EdgeId>();
  for (const e of kept) {
    if (done.has(e)) continue;
    const land = new Set<number>([edgeHex(e)]);
    const queue = [edgeHex(e)];
    for (let i = 0; i < queue.length; i += 1) {
      for (const n of neighbors(hexFromId(queue[i] as number, width))) {
        if (!inBounds(n, width, height)) continue;
        const id = hexId(n, width);
        if (land.has(id) || !own(id)) continue;
        land.add(id);
        queue.push(id);
      }
    }
    const mine = kept.filter((x) => land.has(edgeHex(x)));
    if (capital >= 0 && land.has(capital)) return mine;
    for (const x of mine) done.add(x);
    if (mine.length > best.length) best = mine;
  }
  return best;
}

/** Из ближайших граней — та, что дальше от опоры (участок длиннее); затем меньший EdgeId. */
function pickEnd(candidates: readonly EdgeId[], dist: (e: EdgeId) => number): EdgeId {
  let best = -1;
  let bestDist = -1;
  for (const c of candidates) {
    const d = dist(c);
    if (d > bestDist || (d === bestDist && c < best)) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Концы не соединяются обходом вперёд через все уцелевшие грани: участок шёл «зигзагом»,
 * замкнутый контур открылся или граница разорвалась краем карты. На каждой цепочке контура —
 * наименьшая дуга, покрывающая её отмеченные грани; цепочки — в порядке первой отметки (разрыв
 * только там, где обрывается сам контур).
 */
function coverAll(marksInOrder: readonly EdgeId[], way: Way, limit: number): EdgeId[] {
  const out: EdgeId[] = [];
  const done = new Set<EdgeId>();
  for (const t of marksInOrder) {
    if (done.has(t)) continue;
    const { edges, loop } = chainOf(t, way, limit);
    for (const e of edges) done.add(e);
    out.push(...coverArc(edges, loop, new Set(marksInOrder.filter((e) => edges.includes(e)))));
  }
  return out;
}

// Обход от from в сторону step до обрыва контура (край карты, вода): грани по порядку; null — не
// оборвался (замкнутый контур) или дошёл до stop.
function toBreak(from: EdgeId, step: Way['next'], stop: EdgeId, limit: number): EdgeId[] | null {
  const out = [from];
  for (let e = step(from); out.length < limit; e = step(e)) {
    if (e < 0) return out;
    if (e === stop || e === from) return null;
    out.push(e);
  }
  return null;
}

/**
 * Контур открылся между концами участка (выступ дошёл до края карты): вместо дуги через всю страну
 * — два куска, от конца a вперёд до обрыва и от обрыва до конца b, если в них все уцелевшие грани
 * (04/T18). Иначе null.
 */
function splitAtBreak(
  a: EdgeId,
  b: EdgeId,
  kept: readonly EdgeId[],
  way: Way,
  limit: number,
): EdgeId[] | null {
  const head = toBreak(a, way.next, b, limit);
  const tail = toBreak(b, way.back, a, limit);
  if (!head || !tail) return null;
  const path = [...head, ...tail.reverse()];
  return kept.every((e) => path.includes(e)) ? path : null;
}

/**
 * Дуга контура своей границы, покрывающая отмеченные грани: на каждой цепочке контура — наименьшая
 * дуга через все её отметки (фронт после завершённого наступления, 04/T14b).
 * @returns грани по порядку обхода (со своей стороны); разрыв — только где обрывается контур
 */
export function borderArc(g: LineGround, owner: number, marks: readonly EdgeId[]): EdgeId[] {
  const own = marks.filter((e) => isBorderEdge(g, owner, e));
  if (own.length === 0) return [];
  return coverAll([...new Set(own)], wayOf(g, owner, own), g.hexes.owner.length * 6);
}

/**
 * Участок фронта по точкам-граням своей границы (04/T14a): грани между точками — по границе
 * (`frontEdgePath`), затем укладываются в дугу контура в порядке обхода — одна грань один раз,
 * соседние грани сходятся в углу, без «зигзага» от росчерка туда-обратно.
 * @returns грани по порядку (со своей стороны) или null, если точки не на границе или не соединить
 */
export function frontLinePath(
  g: LineGround,
  owner: number,
  points: readonly EdgeId[],
): EdgeId[] | null {
  const path = frontEdgePath(g, owner, points);
  if (!path) return null;
  const arc = borderArc(g, owner, path);
  return arc.length > 0 ? arc : path;
}

/**
 * Фронт едет за границей от последнего положения (07-controls.md, «Линия фронта»): уцелевшие
 * грани сохраняются; пропавший конец — по внешнему углу, иначе на ближайшую грань границы (не
 * дальше 2 граней, если есть) в той же связной части: из равных — участок длиннее, затем меньший
 * EdgeId; середина — по контуру в прежнем направлении обхода; участок из нескольких граней не
 * схлопывается в одну. Нет границы рядом — грани не меняются.
 * @param capital гекс столицы владельца (-1 — нет): страна — кусок своей земли с ней
 * @returns новые грани по порядку (со своей стороны)
 */
export function followEdges(
  g: LineGround,
  owner: number,
  edges: readonly EdgeId[],
  capital: HexId = -1,
): EdgeId[] {
  const border = (e: EdgeId): boolean => isBorderEdge(g, owner, e);
  if (edges.every(border) && connected(g, edges)) return [...edges];
  const first = edges[0];
  const last = edges.at(-1);
  if (first === undefined || last === undefined) return [];
  const way = wayOf(g, owner, edges);
  const exit = way.entry === 0 ? 1 : 0;
  const limit = g.hexes.owner.length * 6;
  const kept = mainPart(g, owner, edges.filter(border), capital);
  const keptSet = new Set(kept);
  const end = (e: EdgeId, c: Corner, side: 0 | 1, ref: EdgeId | undefined, toRef: Way['next']) => {
    if (keptSet.has(e)) return e;
    // С опорой годятся только грани, от которых до неё дойти по контуру, не переходя участок.
    const dist = (x: EdgeId): number =>
      ref === undefined ? 0 : walkDistance(x, ref, toRef, limit, keptSet);
    const here = edgeAt(g, owner, c, side);
    if (here >= 0 && dist(here) >= 0) return here;
    const near = pickEnd(
      borderNear(g, owner, e, SNAP_HOPS).filter((x) => dist(x) >= 0),
      dist,
    );
    return near >= 0
      ? near
      : pickEnd(
          nearestEnds(g, owner, c, side, (x) => dist(x) >= 0),
          dist,
        );
  };
  const a = end(first, edgeCorners(first)[way.entry], way.entry, kept[0], way.next);
  if (a < 0) return [...edges];
  const b = end(last, edgeCorners(last)[exit], exit, kept.at(-1) ?? a, way.back);
  if (b < 0) return [a];
  // Обход назад не берётся: он увёл бы участок на другую сторону страны.
  const walked = walkPath(a, b, way.next, limit);
  const path =
    walked && kept.every((e) => walked.includes(e))
      ? walked
      : (splitAtBreak(a, b, kept, way, limit) ??
        coverAll([...new Set([a, ...kept, b])], way, limit));
  if (path.length > 1 || edges.length === 1) return path;
  const ahead = way.next(a);
  if (ahead >= 0) return [a, ahead];
  const behind = way.back(a);
  return behind >= 0 ? [behind, a] : path;
}
