// Линия наступления, которую строит commander по ▶ у армии с автокомандованием (CR-006;
// gdd/07-controls.md, «Автокомандование»): кольцо на глубине COMMANDER_LINE_DEPTH гексов от фронта
// по земле врага или до ближайшего вражеского города, если он ближе.
import { COMMANDER_LINE_DEPTH } from '../balance.ts';
import type { MapStatic } from '../map/types.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { offensiveEdgePath } from '../state/edge-line.ts';
import {
  cornerKey,
  edgeCorners,
  edgeHex,
  edgeOf,
  edgeOther,
  isLandEdge,
  type EdgeId,
} from '../state/edges.ts';

type Ground = { map: MapStatic; hexes: { owner: Int16Array } };

/** Что нужно линии от мира: владельцы гексов и города (снимок игрока или состояние матча). */
export interface LineView {
  readonly hexes: { readonly owner: Int16Array };
  readonly cities: readonly { readonly hex: HexId; readonly owner: number }[];
}

/** Чей гекс считается вражеским: игрок цели или весь его блок. */
type Enemy = (owner: number) => boolean;

function around(map: MapStatic, h: HexId): HexId[] {
  return neighbors(hexFromId(h, map.width))
    .filter((n) => inBounds(n, map.width, map.height))
    .map((n) => hexId(n, map.width));
}

// Шагов от фронта по земле врага (поиск в ширину от гексов врага за гранями фронта). Для каждого
// гекса запоминается и «исток» — номер грани фронта, от которой дошла волна: по нему линия режется
// вдоль фронта, а не огибает его концы.
function depthFromFront(g: Ground, front: readonly EdgeId[], isEnemy: Enemy, limit: number) {
  const dist = new Map<HexId, number>();
  const origin = new Map<HexId, number>();
  const queue: HexId[] = [];
  front.forEach((e, i) => {
    const n = edgeOther(g, e);
    if (n < 0 || !isEnemy(g.hexes.owner[n] as number) || dist.has(n)) return;
    dist.set(n, 1);
    origin.set(n, i);
    queue.push(n);
  });
  for (let i = 0; i < queue.length; i += 1) {
    const h = queue[i] as HexId;
    const d = dist.get(h) as number;
    if (d >= limit) continue;
    for (const n of around(g.map, h)) {
      if (dist.has(n) || !isEnemy(g.hexes.owner[n] as number) || g.map.terrain[n] === TERRAIN.water)
        continue;
      dist.set(n, d + 1);
      origin.set(n, origin.get(h) as number);
      queue.push(n);
    }
  }
  return { dist, origin };
}

/** Сколько граней у каждого конца участка отсекается: на концах волна огибает фронт, и линия загибалась бы назад. */
const END_CAP = 1;
/** Обрывок короче этого, граней, рядом с основной линией — случайный клочок, а не часть стены. */
const STRAY_EDGES = 4;

/**
 * Линия наступления армии с фронтом на врага enemy: грани между гексами на глубине D от фронта и
 * гексами глубже, D — COMMANDER_LINE_DEPTH или глубина ближайшего вражеского города, если меньше.
 * Грани упорядочены вдоль фронта. `keep` оставляет лишь нужные гексы линии — стена впереди, а не
 * кольцо вокруг фронта.
 * @returns грани линии (точки для setOffensiveLine); пусто — строить нечего
 */
export function commanderLine(
  map: MapStatic,
  view: LineView,
  front: readonly EdgeId[],
  enemyOrBloc: number | Enemy,
  maxDepth: number = COMMANDER_LINE_DEPTH,
  keep?: (hex: HexId) => boolean,
): EdgeId[] {
  const g = { map, hexes: view.hexes };
  const isEnemy: Enemy =
    typeof enemyOrBloc === 'number' ? (who) => who === enemyOrBloc : enemyOrBloc;
  const { dist, origin } = depthFromFront(g, front, isEnemy, maxDepth + 1);
  // Стена впереди участка: гексы глубины D с истоком в средней части; концы фронта не огибаются.
  const cap = front.length >= 3 * END_CAP + 2 ? END_CAP : 0;
  const across = (h: HexId): boolean => {
    const o = origin.get(h);
    return o === undefined || (o >= cap && o < front.length - cap);
  };
  // Земли цели может быть мельче заказанной глубины (узкий перешеек, край карты): берём её дно.
  let depth = Math.min(maxDepth, Math.max(0, ...dist.values()));
  for (const c of view.cities) {
    const d = dist.get(c.hex);
    if (isEnemy(c.owner) && d !== undefined && d < depth) depth = d;
  }
  const line: EdgeId[] = [];
  for (const [h, d] of [...dist].sort((a, b) => a[0] - b[0])) {
    if (d !== depth || (keep && !keep(h)) || !across(h)) continue;
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
  const ordered = line.sort((a, b) => at(a) - at(b) || a - b);
  const path = withoutStrays(g, offensiveEdgePath(g, ordered) ?? []);
  // Срез по `keep` мог разорвать линию: тогда строим без него.
  if (path.length > 0) return path;
  if (keep) return commanderLine(map, view, front, enemyOrBloc, maxDepth);
  // Дно земли цели у края карты линии не даёт: берём слой мельче.
  return maxDepth > 1 ? commanderLine(map, view, front, enemyOrBloc, maxDepth - 1) : [];
}

// Клочки линии (меньше STRAY_EDGES граней) выбрасываются, если есть настоящая цепочка: линия
// не должна рваться на куски и тянуться в разные стороны.
function withoutStrays(g: Ground, path: readonly EdgeId[]): EdgeId[] {
  const runs = runsOf(g, path);
  if (runs.length <= 1) return [...path];
  const longest = Math.max(...runs.map((r) => r.length));
  const kept = runs.filter((r) => r.length >= STRAY_EDGES || r.length === longest);
  return kept.flat();
}

// Цепочки подряд идущих граней, сходящихся в углу (как lineRuns, но без состояния матча).
function runsOf(g: Ground, line: readonly EdgeId[]): EdgeId[][] {
  const runs: EdgeId[][] = [];
  for (const e of line) {
    const run = runs.at(-1);
    const prev = run?.at(-1);
    if (run && prev !== undefined && sharesCorner(g, prev, e)) run.push(e);
    else runs.push([e]);
  }
  return runs;
}

function sharesCorner(g: Ground, a: EdgeId, b: EdgeId): boolean {
  const keys = new Set(edgeCorners(a).map((c) => cornerKey(g, c)));
  return edgeCorners(b).some((c) => keys.has(cornerKey(g, c)));
}
