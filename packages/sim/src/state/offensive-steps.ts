// Шаги наступления к линии (04/T14b): расстояние до линии по проходимым гексам, грани фронта,
// смотрящие на линию, и соседние гексы, где отряд становится строго ближе к линии.
// Общее для offensiveSystem, frontAllocator и снимка игрока (прогноз у линии).
// GDD: docs/gdd/07-controls.md — «Линия наступления».
import { canonicalEdge } from './edge-line.ts';
import { edgeHex, edgeOther, type EdgeId } from './edges.ts';
import type { LineGround } from './ground.ts';
import { OFFENSIVE_FACING_RANGE } from '../balance.ts';
import { TERRAIN } from '../map/types.ts';
import {
  distance,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  type Hex,
  type HexId,
} from '../math/hex.ts';

const SIDES = 6;

// Соседи всех гексов карты (6 на гекс, -1 — за краем). Карта в матче не меняется — таблица
// считается один раз на карту.
const tables = new WeakMap<LineGround['map'], Int32Array>();

function neighborTable(g: LineGround): Int32Array {
  const cached = tables.get(g.map);
  if (cached) return cached;
  const { width, height } = g.map;
  const table = new Int32Array(width * height * SIDES).fill(-1);
  for (let h = 0; h < width * height; h += 1) {
    neighbors(hexFromId(h, width)).forEach((n, d) => {
      if (inBounds(n, width, height)) table[h * SIDES + d] = hexId(n, width);
    });
  }
  tables.set(g.map, table);
  return table;
}

function adjacent(g: LineGround, hex: HexId): HexId[] {
  const table = neighborTable(g);
  const out: HexId[] = [];
  for (let d = 0; d < SIDES; d += 1) {
    const n = table[hex * SIDES + d] as number;
    if (n >= 0) out.push(n);
  }
  return out;
}

const passable = (g: LineGround, h: HexId): boolean =>
  g.map.terrain[h] !== undefined && g.map.terrain[h] !== TERRAIN.water;

// dt зависит только от местности и гексов линии: массив гексов линии живёт, пока линия не
// перерисована, — расстояния считаются один раз на линию. На результат кэш не влияет.
const distances = new WeakMap<readonly HexId[], Int32Array>();

/**
 * Расстояние до линии наступления (dt): шагов до ближайшего гекса линии по проходимым гексам,
 * поиск в ширину. Результат общий для всех вызовов с той же линией — не изменять.
 * @returns dt по HexId; -1 — вода или не дойти
 */
export function lineDistance(g: LineGround, line: readonly HexId[]): Int32Array {
  const cached = distances.get(line);
  if (cached && cached.length === g.hexes.owner.length) return cached;
  const table = neighborTable(g);
  const dist = new Int32Array(g.hexes.owner.length).fill(-1);
  const queue = new Int32Array(dist.length);
  let tail = 0;
  for (const h of line) {
    if (!passable(g, h) || dist[h] === 0) continue;
    dist[h] = 0;
    queue[tail] = h;
    tail += 1;
  }
  for (let i = 0; i < tail; i += 1) {
    const h = queue[i] as HexId;
    const next = (dist[h] as number) + 1;
    for (let d = 0; d < SIDES; d += 1) {
      const n = table[h * SIDES + d] as number;
      if (n < 0 || dist[n] !== -1 || !passable(g, n)) continue;
      dist[n] = next;
      queue[tail] = n;
      tail += 1;
    }
  }
  distances.set(line, dist);
  return dist;
}

/**
 * Шагов от участка фронта до гекса по проходимым гексам, не пересекая грани линии наступления:
 * по нему выбирается сторона линии, обращённая к фронту.
 * @returns расстояние по HexId; -1 — вода или не дойти, не переходя линию
 */
export function frontSideDistance(
  g: LineGround,
  front: readonly HexId[],
  line: readonly EdgeId[],
): Int32Array {
  const table = neighborTable(g);
  const wall = new Set(line.map((e) => canonicalEdge(g, e)));
  const dist = new Int32Array(g.hexes.owner.length).fill(-1);
  const queue: HexId[] = [];
  for (const h of front) {
    if (!passable(g, h) || dist[h] === 0) continue;
    dist[h] = 0;
    queue.push(h);
  }
  for (let i = 0; i < queue.length; i += 1) {
    const h = queue[i] as HexId;
    for (let d = 0; d < SIDES; d += 1) {
      const n = table[h * SIDES + d] as number;
      if (n < 0 || dist[n] !== -1 || !passable(g, n)) continue;
      if (wall.has(canonicalEdge(g, h * SIDES + d))) continue;
      dist[n] = (dist[h] as number) + 1;
      queue.push(n);
    }
  }
  return dist;
}

// Шаг из a в b ведёт к линии: у b dt строго меньше (у a без dt — любой b с dt) или это шаг
// вдоль линии — оба гекса на линии (dt 0 → 0). За линию шага нет: меньше 0 dt не бывает.
function advances(dist: Int32Array, a: HexId, b: HexId): boolean {
  const da = dist[a] ?? -1;
  const db = dist[b] ?? -1;
  return db >= 0 && (da < 0 || db < da || (da === 0 && db === 0));
}

// Гексы фронта не дальше OFFENSIVE_FACING_RANGE от «точек фронта у линии»: для каждого гекса
// линии — ближайшие к нему гексы фронта. Длинный фронт не посылает удар издалека через свою
// землю, а выступ, уже дошедший до линии, не сужает удар: к другим гексам линии ближе другая часть
// фронта. Ни один гекс фронта не дотягивается до линии — ограничения нет.
function nearLine(
  g: LineGround,
  edges: readonly EdgeId[],
  dist: Int32Array,
): (h: HexId) => boolean {
  const hexes = [...new Set(edges.map(edgeHex))].filter((h) => (dist[h] ?? -1) >= 0);
  if (hexes.length === 0) return () => true;
  const width = g.map.width;
  const front = hexes.map((h) => hexFromId(h, width));
  const anchors: Hex[] = [];
  dist.forEach((d, l) => {
    if (d !== 0) return;
    const at = hexFromId(l, width);
    const ds = front.map((f) => distance(f, at));
    const min = Math.min(...ds);
    front.forEach((f, i) => {
      if (ds[i] === min) anchors.push(f);
    });
  });
  return (h) => {
    const p = hexFromId(h, width);
    return anchors.some((a) => distance(a, p) <= OFFENSIVE_FACING_RANGE);
  };
}

/**
 * Грани фронта, смотрящие на линию: гекс за гранью ближе к линии, чем свой, или оба на линии, и
 * свой гекс не дальше OFFENSIVE_FACING_RANGE от гекса фронта, ближайшего к какому-нибудь гексу линии.
 * @returns грани в порядке фронта
 */
export function facingEdges(g: LineGround, edges: readonly EdgeId[], dist: Int32Array): EdgeId[] {
  const near = nearLine(g, edges, dist);
  return edges.filter((e) => {
    const other = edgeOther(g, e);
    return other >= 0 && advances(dist, edgeHex(e), other) && near(edgeHex(e));
  });
}

/**
 * Свои гексы фронта со смотрящей на линию гранью (facingEdges).
 * @returns HexId по возрастанию, без повторов
 */
export function facingHexes(g: LineGround, edges: readonly EdgeId[], dist: Int32Array): HexId[] {
  return [...new Set(facingEdges(g, edges, dist).map(edgeHex))].sort((a, b) => a - b);
}

/**
 * Шаги к линии из гекса: соседние чужие или ничейные проходимые гексы с dt строго меньше, чем у
 * этого гекса, а с гекса линии — ещё и соседние гексы линии (шаг вдоль линии). За линию шагов нет.
 * @returns HexId по возрастанию dt, при равенстве — HexId
 */
export function stepsToward(g: LineGround, owner: number, from: HexId, dist: Int32Array): HexId[] {
  return adjacent(g, from)
    .filter((n) => g.hexes.owner[n] !== owner && passable(g, n) && advances(dist, from, n))
    .sort((a, b) => (dist[a] as number) - (dist[b] as number) || a - b);
}

/**
 * Гексы, куда могут шагнуть отряды с граней фронта, смотрящих на линию (для прогноза у линии).
 * @returns HexId по возрастанию, без повторов
 */
export function offensiveTargets(
  g: LineGround,
  owner: number,
  edges: readonly EdgeId[],
  line: readonly HexId[],
): HexId[] {
  const dist = lineDistance(g, line);
  const out = new Set<HexId>();
  for (const h of facingHexes(g, edges, dist)) {
    for (const n of stepsToward(g, owner, h, dist)) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Анклавы у земли, взятой наступлением: чужие проходимые гексы в «дырах» своей земли — связных
 * кусках не своих гексов (вода входит в кусок), не касающихся края карты, — рядом с гексами taken,
 * ставшими своими.
 * @returns HexId по возрастанию
 */
export function enclaveHexes(g: LineGround, owner: number, taken: readonly HexId[]): HexId[] {
  const table = neighborTable(g);
  const seen = new Uint8Array(g.hexes.owner.length);
  const out: HexId[] = [];
  for (const t of taken) {
    if (g.hexes.owner[t] !== owner) continue;
    for (let d = 0; d < SIDES; d += 1) {
      const start = table[t * SIDES + d] as number;
      if (start < 0 || seen[start] || g.hexes.owner[start] === owner) continue;
      const comp: HexId[] = [start];
      seen[start] = 1;
      let open = false;
      for (let i = 0; i < comp.length; i += 1) {
        const h = comp[i] as HexId;
        for (let k = 0; k < SIDES; k += 1) {
          const n = table[h * SIDES + k] as number;
          if (n < 0) open = true;
          if (n < 0 || seen[n] || g.hexes.owner[n] === owner) continue;
          seen[n] = 1;
          comp.push(n);
        }
      }
      if (!open) out.push(...comp.filter((h) => passable(g, h)));
    }
  }
  return out.sort((a, b) => a - b);
}

/** Соседние гексы из набора, по возрастанию HexId. */
export function neighborsIn(g: LineGround, hex: HexId, set: ReadonlySet<HexId>): HexId[] {
  return adjacent(g, hex)
    .filter((n) => set.has(n))
    .sort((a, b) => a - b);
}
