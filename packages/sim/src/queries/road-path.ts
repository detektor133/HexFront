// Путь для дороги: только по своим гексам, веса местности, вода и горы без перевала непроходимы.
// GDD: docs/gdd/04-roads-supply.md — «Дороги»; docs/gdd/01-map.md — «Дороги».
import { MOVE_TIME_S } from '../balance.ts';
import { FEATURE, TERRAIN, TERRAIN_NAMES } from '../map/types.ts';
import { createHeap, heapPop, heapPush } from '../math/heap.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import type { MatchState } from '../state/types.ts';

/**
 * Стоимость входа дороги в гекс: время хода по местности; перевал — как холмы.
 * @returns fixed-point секунд или null, если дорога здесь невозможна
 */
export function roadStepCost(state: MatchState, hex: HexId): number | null {
  const terrain = state.map.terrain[hex] ?? TERRAIN.water;
  const isPass = state.map.features[hex] === FEATURE.pass;
  if (terrain === TERRAIN.water) return null;
  if (terrain === TERRAIN.mountains && !isPass) return null;
  const name = isPass ? 'hills' : TERRAIN_NAMES[terrain];
  if (!name || name === 'water') return null;
  return MOVE_TIME_S[name];
}

const UNREACHED = 0x7fffffff;

function reconstruct(prev: Int32Array, end: HexId): HexId[] {
  const path = [end];
  let at = prev[end] ?? -1;
  while (at >= 0) {
    path.push(at);
    at = prev[at] ?? -1;
  }
  return path.reverse();
}

/**
 * Кратчайший путь дороги от from до ближайшей цели по своим гексам владельца (Дейкстра,
 * ничьи — по меньшему HexId, поэтому результат детерминирован).
 * @returns гексы от from до цели включительно или null, если пути нет
 */
export function findRoadPath(
  state: MatchState,
  owner: number,
  from: HexId,
  isTarget: (hex: HexId) => boolean,
): HexId[] | null {
  const { width, height } = state.map;
  const size = width * height;
  // Путь не длиннее 5 000 FP × число гексов — помещается в Int32.
  const dist = new Int32Array(size).fill(UNREACHED);
  const prev = new Int32Array(size).fill(-1);
  const heap = createHeap();
  dist[from] = 0;
  heapPush(heap, 0, from);
  for (let top = heapPop(heap); top; top = heapPop(heap)) {
    const [d, hex] = top;
    if (d > (dist[hex] ?? 0)) continue;
    if (hex !== from && isTarget(hex)) return reconstruct(prev, hex);
    for (const n of neighbors(hexFromId(hex, width))) {
      if (!inBounds(n, width, height)) continue;
      const id = hexId(n, width);
      if (state.hexes.owner[id] !== owner) continue;
      const cost = roadStepCost(state, id);
      if (cost === null) continue;
      const nd = d + cost;
      if (nd < (dist[id] ?? 0)) {
        dist[id] = nd;
        prev[id] = hex;
        heapPush(heap, nd, id);
      }
    }
  }
  return null;
}
