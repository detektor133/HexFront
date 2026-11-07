// Морские маршруты между портами и на вражеский берег (03-cities-buildings.md, «Порты»): поиск в
// ширину по клеткам воды от порта отправки. Один расчёт на команду и на подсветку в интерфейсе.
import { SEA_MAX_HEXES } from '../balance.ts';
import type { MapStatic } from '../map/types.ts';
import { TERRAIN } from '../map/types.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { waterNeighbors } from '../state/port.ts';

/** Расстояния по воде от порта: шагов до клетки воды (1 — рядом с портом), −1 — не дойти. */
export interface SeaField {
  readonly dist: Int16Array;
  readonly prev: Int32Array;
}

/**
 * Поиск в ширину по воде от соседних с портом клеток не дальше SEA_MAX_HEXES шагов.
 * @returns расстояния и предыдущие клетки пути
 */
export function seaField(map: MapStatic, from: HexId): SeaField {
  const size = map.width * map.height;
  const dist = new Int16Array(size).fill(-1);
  const prev = new Int32Array(size).fill(-1);
  const queue: HexId[] = [];
  for (const n of waterNeighbors(map, from)) {
    dist[n] = 1;
    queue.push(n);
  }
  for (let i = 0; i < queue.length; i += 1) {
    const h = queue[i] as HexId;
    const d = dist[h] as number;
    if (d >= SEA_MAX_HEXES) continue;
    for (const n of neighbors(hexFromId(h, map.width))) {
      if (!inBounds(n, map.width, map.height)) continue;
      const id = hexId(n, map.width);
      if (map.terrain[id] !== TERRAIN.water || dist[id] !== -1) continue;
      dist[id] = d + 1;
      prev[id] = h;
      queue.push(id);
    }
  }
  return { dist, prev };
}

/**
 * Куда можно приплыть из порта: сухопутные гексы у воды, до которых по воде не дальше
 * SEA_MAX_HEXES клеток. Порт отправки не включается.
 * @returns гекс назначения → сколько клеток воды проплывать
 */
export function seaTargets(map: MapStatic, from: HexId): Map<HexId, number> {
  const field = seaField(map, from);
  const out = new Map<HexId, number>();
  for (let h = 0; h < field.dist.length; h += 1) {
    if (map.terrain[h] === TERRAIN.water || h === from) continue;
    let best = -1;
    for (const w of waterNeighbors(map, h)) {
      const d = field.dist[w] ?? -1;
      if (d > 0 && (best < 0 || d < best)) best = d;
    }
    if (best > 0) out.set(h, best);
  }
  return out;
}

/**
 * Путь по воде от порта до гекса назначения: клетки воды по порядку и сам гекс назначения.
 * @returns путь или null, если по воде не добраться
 */
export function planSeaRoute(map: MapStatic, from: HexId, to: HexId): HexId[] | null {
  if (from === to || map.terrain[to] === TERRAIN.water) return null;
  const field = seaField(map, from);
  let goal = -1;
  for (const w of waterNeighbors(map, to)) {
    const d = field.dist[w] ?? -1;
    if (d > 0 && (goal < 0 || d < (field.dist[goal] ?? 0))) goal = w;
  }
  if (goal < 0) return null;
  const path: HexId[] = [to];
  for (let at = goal; at >= 0; at = field.prev[at] ?? -1) path.push(at);
  return path.reverse();
}

/**
 * Путь по воде от клетки воды start до гекса суши to (соседнего с водой): клетки воды и сам to.
 * Для возврата отряда в порт, когда на воде приказ пропал.
 * @returns путь без start или null, если не дойти за SEA_MAX_HEXES
 */
export function planSeaRouteFrom(map: MapStatic, start: HexId, to: HexId): HexId[] | null {
  const goals = new Set(waterNeighbors(map, to));
  if (goals.size === 0) return null;
  const size = map.width * map.height;
  const dist = new Int16Array(size).fill(-1);
  const prev = new Int32Array(size).fill(-1);
  dist[start] = 0;
  const queue: HexId[] = [start];
  let goal = goals.has(start) ? start : -1;
  for (let i = 0; i < queue.length && goal < 0; i += 1) {
    const h = queue[i] as HexId;
    const d = dist[h] as number;
    if (d >= SEA_MAX_HEXES * 2) continue;
    for (const n of neighbors(hexFromId(h, map.width))) {
      if (!inBounds(n, map.width, map.height)) continue;
      const id = hexId(n, map.width);
      if (map.terrain[id] !== TERRAIN.water || dist[id] !== -1) continue;
      dist[id] = d + 1;
      prev[id] = h;
      queue.push(id);
      if (goals.has(id)) {
        goal = id;
        break;
      }
    }
  }
  if (goal < 0) return null;
  const path: HexId[] = [to];
  for (let at = goal; at !== start && at >= 0; at = prev[at] ?? -1) path.push(at);
  return path.reverse();
}
