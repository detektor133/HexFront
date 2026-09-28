// Линия наступления, которую строит commander по ▶ у армии с автокомандованием (CR-006;
// gdd/07-controls.md, «Автокомандование»): кольцо на глубине COMMANDER_LINE_DEPTH гексов от фронта
// по земле врага или до ближайшего вражеского города, если он ближе.
import { COMMANDER_LINE_DEPTH } from '../balance.ts';
import type { MapStatic } from '../map/types.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import type { PlayerView } from '../queries/player-view.ts';
import { edgeHex, edgeOf, edgeOther, isLandEdge, type EdgeId } from '../state/edges.ts';

type Ground = { map: MapStatic; hexes: { owner: Int16Array } };

function around(map: MapStatic, h: HexId): HexId[] {
  return neighbors(hexFromId(h, map.width))
    .filter((n) => inBounds(n, map.width, map.height))
    .map((n) => hexId(n, map.width));
}

// Шагов от фронта по земле врага (поиск в ширину от гексов врага за гранями фронта).
function depthFromFront(g: Ground, front: readonly EdgeId[], enemy: number, limit: number) {
  const dist = new Map<HexId, number>();
  const queue: HexId[] = [];
  for (const e of front) {
    const n = edgeOther(g, e);
    if (n < 0 || g.hexes.owner[n] !== enemy || dist.has(n)) continue;
    dist.set(n, 1);
    queue.push(n);
  }
  for (let i = 0; i < queue.length; i += 1) {
    const h = queue[i] as HexId;
    const d = dist.get(h) as number;
    if (d >= limit) continue;
    for (const n of around(g.map, h)) {
      if (dist.has(n) || g.hexes.owner[n] !== enemy || g.map.terrain[n] === TERRAIN.water) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

/**
 * Линия наступления армии с фронтом на врага enemy: грани между гексами на глубине D от фронта и
 * гексами глубже, D — COMMANDER_LINE_DEPTH или глубина ближайшего вражеского города, если меньше.
 * Грани упорядочены вдоль фронта.
 * @returns грани линии (точки для setOffensiveLine); пусто — строить нечего
 */
export function commanderLine(
  map: MapStatic,
  view: PlayerView,
  front: readonly EdgeId[],
  enemy: number,
): EdgeId[] {
  const g = { map, hexes: view.hexes };
  const dist = depthFromFront(g, front, enemy, COMMANDER_LINE_DEPTH + 1);
  let depth = COMMANDER_LINE_DEPTH;
  for (const c of view.cities) {
    const d = dist.get(c.hex);
    if (c.owner === enemy && d !== undefined && d < depth) depth = d;
  }
  const line: EdgeId[] = [];
  for (const [h, d] of [...dist].sort((a, b) => a[0] - b[0])) {
    if (d !== depth) continue;
    for (let dir = 0; dir < 6; dir += 1) {
      const e = edgeOf(h, dir);
      const n = edgeOther(g, e);
      if (n < 0 || !isLandEdge(g, e)) continue;
      const beyond = dist.get(n);
      if (beyond === undefined || beyond > depth) line.push(e);
    }
  }
  // Вдоль фронта: по ближайшей грани фронта, затем по EdgeId.
  const at = (e: EdgeId): number => {
    const p = hexFromId(edgeHex(e), map.width);
    let best = 0;
    let bestD = Number.MAX_SAFE_INTEGER;
    front.forEach((f, i) => {
      const d = distance(p, hexFromId(edgeHex(f), map.width));
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };
  return line.sort((a, b) => at(a) - at(b) || a - b);
}
