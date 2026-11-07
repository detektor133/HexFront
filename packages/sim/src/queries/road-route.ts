// Маршрут дороги, который прокладывает игрок вручную: от точки к точке по своей земле через заданные
// промежуточные точки. Один расчёт на команду и на предпросмотр в интерфейсе.
// GDD: docs/gdd/04-roads-supply.md — «Дорога вручную».
import { findRoadPath, roadStepCost, type RoadGround } from './road-path.ts';
import { MAX_ROAD_POINTS, ROAD_MAX_NEW_HEXES } from '../balance.ts';
import type { HexId } from '../math/hex.ts';

/** Маршрут: все гексы пути подряд и те из них, где дороги ещё нет (в порядке прокладки). */
export type RoadRoute =
  | { readonly ok: true; readonly path: HexId[]; readonly toBuild: HexId[] }
  | {
      readonly ok: false;
      readonly reason: 'badHex' | 'notOwnHex' | 'noPath' | 'alreadyBuilt' | 'roadTooLong';
    };

/**
 * Считает маршрут по точкам: между соседними точками — кратчайший путь по своим гексам.
 * @param points точки по порядку, не меньше двух и не больше MAX_ROAD_POINTS
 * @param cityHexes гексы городов: в них дорога не нужна
 * @returns маршрут или причина отказа
 */
export function planRoadRoute(
  g: RoadGround,
  owner: number,
  points: readonly HexId[],
  cityHexes: ReadonlySet<HexId>,
): RoadRoute {
  const size = g.map.width * g.map.height;
  if (points.length < 2 || points.length > MAX_ROAD_POINTS) return { ok: false, reason: 'badHex' };
  for (const p of points) {
    if (!Number.isInteger(p) || p < 0 || p >= size) return { ok: false, reason: 'badHex' };
    if (g.hexes.owner[p] !== owner) return { ok: false, reason: 'notOwnHex' };
    if (roadStepCost(g, p) === null) return { ok: false, reason: 'badHex' };
  }
  const path: HexId[] = [points[0] as HexId];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1] as HexId;
    const to = points[i] as HexId;
    if (from === to) continue;
    const leg = findRoadPath(g, owner, from, (h) => h === to);
    if (!leg) return { ok: false, reason: 'noPath' };
    path.push(...leg.slice(1));
  }
  const seen = new Set<HexId>();
  const toBuild = path.filter((h) => {
    if (seen.has(h)) return false;
    seen.add(h);
    return g.hexes.road[h] !== 1 && !cityHexes.has(h);
  });
  if (toBuild.length === 0) return { ok: false, reason: 'alreadyBuilt' };
  if (toBuild.length > ROAD_MAX_NEW_HEXES) return { ok: false, reason: 'roadTooLong' };
  return { ok: true, path, toBuild };
}

/**
 * Начало и конец дороги — свой город или склад (узлы сети): так дорога соединяет узлы, а не
 * превращает произвольные гексы в магистраль. Промежуточные точки только задают форму маршрута.
 * @returns true, если оба конца — узлы
 */
export function roadEndsAreNodes(points: readonly HexId[], nodes: ReadonlySet<HexId>): boolean {
  const first = points[0];
  const last = points.at(-1);
  return first !== undefined && last !== undefined && nodes.has(first) && nodes.has(last);
}
