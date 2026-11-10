// Путь и время перехода отрядов: A* по времени хода, стабильные ничьи по HexId.
// GDD: docs/gdd/05-armies.md — «Движение», «Захват»; 01-map.md — «Местность».
import {
  ATTRITION_THRESHOLD,
  LOW_SUPPLY_SPEED_MULT,
  MAX_UNITS_PER_HEX,
  MOVE_TIME_S,
  UNIT_SPEED_MULT,
  RIVER_MOVE_PENALTY_S,
  ROAD_MOVE_MULT,
  SEA_MOVE_S_PER_HEX,
  SPEED,
  TICKS_PER_S,
  ZOC_MOVE_MULT,
  type LandTerrain,
  type UnitType,
} from '../balance.ts';
import { composeSeaPath, ownPortSet } from './sea-path.ts';
import { neighborTable, SIDES } from '../map/neighbor-table.ts';
import { FEATURE, TERRAIN, TERRAIN_NAMES } from '../map/types.ts';
import { createHeap, heapPop, heapPush, type MinHeap } from '../math/heap.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { FP, fpDiv, fpMul, intDiv, type Fp } from '../math/int.ts';
import { atWar, protectsFrom } from '../state/relations.ts';
import type { MatchState } from '../state/types.ts';
import { unitIndex } from '../state/unit-index.ts';

/** Местность для времени хода: перевал — как холмы; null — вода. */
function moveTerrain(state: MatchState, hex: HexId): LandTerrain | null {
  const code = state.map.terrain[hex] ?? TERRAIN.water;
  if (code === TERRAIN.water) return null;
  if (code === TERRAIN.mountains && state.map.features[hex] === FEATURE.pass) return 'hills';
  const name = TERRAIN_NAMES[code];
  return name === undefined || name === 'water' ? null : name;
}

/** Сколько отрядов игрока стоит в гексе. */
export function ownUnitsAt(state: MatchState, owner: number, hex: HexId): number {
  let n = 0;
  for (const unit of unitIndex(state).unitsByHex[hex] ?? []) if (unit.owner === owner) n += 1;
  return n;
}

/**
 * Гекс занят врагом: вражеский отряд, ополчение чужого города или гарнизон нейтрального.
 * Войти в такой гекс можно только через бой.
 */
export function isHostileHex(state: MatchState, owner: number, hex: HexId): boolean {
  if ((unitIndex(state).unitsByHex[hex] ?? []).some((unit) => atWar(state, owner, unit.owner))) {
    return true;
  }
  const city = unitIndex(state).cityByHex[hex];
  if (!city || city.owner === owner || (city.owner >= 0 && !atWar(state, owner, city.owner))) {
    return false;
  }
  return city.defenders > 0;
}

/**
 * Гекс неприкосновенен для отряда игрока owner: его территория, отряды или город принадлежат
 * игроку не в войне и не союзнику (дипломатия, CR-007) — войти нельзя, пока не объявлена война.
 */
export function peaceBlocked(state: MatchState, owner: number, hex: HexId): boolean {
  if (!state.diplomacy) return false;
  const land = state.hexes.owner[hex] ?? -1;
  if (protectsFrom(state, owner, land)) return true;
  const city = unitIndex(state).cityByHex[hex];
  if (city && protectsFrom(state, owner, city.owner)) return true;
  return (unitIndex(state).unitsByHex[hex] ?? []).some((u) => protectsFrom(state, owner, u.owner));
}

// Маска зоны контроля игрока: гексы, рядом с которыми стоит отряд того, с кем война. Строится раз
// на состав отрядов и тик: поиск пути спрашивает её на каждом шаге, а считать соседей заново — дорого.
const zocMasks = new WeakMap<
  MatchState,
  { rev: number; tick: number; masks: Map<number, Uint8Array> }
>();

/** Зона контроля: рядом с гексом стоит отряд другого игрока. */
function inEnemyZoc(state: MatchState, owner: number, hex: HexId): boolean {
  const index = unitIndex(state);
  let cache = zocMasks.get(state);
  if (!cache || cache.rev !== index.rev || cache.tick !== state.tick) {
    cache = { rev: index.rev, tick: state.tick, masks: new Map() };
    zocMasks.set(state, cache);
  }
  let mask = cache.masks.get(owner);
  if (!mask) {
    const { width, height } = state.map;
    const table = neighborTable(state.map);
    mask = new Uint8Array(width * height);
    for (const unit of state.units) {
      if (!atWar(state, owner, unit.owner)) continue;
      for (let d = 0; d < SIDES; d += 1) {
        const n = table[unit.hex * SIDES + d] as number;
        if (n >= 0) mask[n] = 1;
      }
    }
    cache.masks.set(owner, mask);
  }
  return mask[hex] === 1;
}

// Направление ребра from→to (индекс в neighbors) или -1, если гексы не соседи.
function directionTo(state: MatchState, from: HexId, to: HexId): number {
  const { width } = state.map;
  const target = hexFromId(to, width);
  return neighbors(hexFromId(from, width)).findIndex((n) => n.q === target.q && n.r === target.r);
}

/** Кто и как идёт: тип, владелец, снабжённость (fixed-point доля). */
export interface Mover {
  readonly type: UnitType;
  readonly owner: number;
  readonly supplyLevel: Fp;
  /** Отряд плывёт: ему доступны клетки воды. */
  readonly sea?: boolean;
  /** Вражеский гекс, который можно пройти с боем (слабый враг по прогнозу); иначе враг — преграда. */
  readonly passHostile?: (hex: HexId) => boolean;
}

/**
 * Время перехода между соседними гексами:
 * MOVE_TIME_S / SPEED / UNIT_SPEED_MULT × ROAD_MOVE_MULT (оба гекса дорожные) + RIVER_MOVE_PENALTY_S (река на ребре),
 * × ZOC_MOVE_MULT (назначение рядом с врагом), ÷ LOW_SUPPLY_SPEED_MULT (снабжение < 50 %).
 * @returns тики, не меньше 1; null — гекс непроходим или не сосед
 */
export function stepTicks(state: MatchState, m: Mover, from: HexId, to: HexId): number | null {
  // Вода в путь попадает только из морского звена составного поиска; проход по ней одинаково быстр.
  if ((state.map.terrain[to] ?? 0) === TERRAIN.water) {
    return Math.max(1, intDiv(SEA_MOVE_S_PER_HEX * TICKS_PER_S, FP));
  }
  const terrain = moveTerrain(state, to);
  const dir = directionTo(state, from, to);
  if (terrain === null || dir < 0) return null;
  let t = fpDiv(fpDiv(MOVE_TIME_S[terrain], SPEED[m.type][terrain]), UNIT_SPEED_MULT);
  const { road } = state.hexes;
  if (road[from] === 1 && road[to] === 1) t = fpMul(t, ROAD_MOVE_MULT);
  if (((state.map.rivers[from] ?? 0) >> dir) & 1) t = (t + RIVER_MOVE_PENALTY_S) as Fp;
  if (inEnemyZoc(state, m.owner, to)) t = fpMul(t, ZOC_MOVE_MULT);
  if (m.supplyLevel < ATTRITION_THRESHOLD) t = fpDiv(t, LOW_SUPPLY_SPEED_MULT);
  return Math.max(1, intDiv(t * TICKS_PER_S, FP));
}

// Нижняя граница шага для эвристики A*: самая быстрая местность по дороге.
function minStepTicks(type: UnitType): number {
  let best = Infinity;
  for (const name of Object.keys(MOVE_TIME_S) as LandTerrain[]) {
    const t = fpMul(fpDiv(MOVE_TIME_S[name], SPEED[type][name]), ROAD_MOVE_MULT);
    best = Math.min(best, Math.max(1, intDiv(t * TICKS_PER_S, FP)));
  }
  return best;
}

/**
 * Можно ли отряду войти в гекс по пути. Артиллерия — только в свои гексы; промежуточные гексы
 * не должны быть заняты врагом или заполнены своими отрядами; цель может быть вражеской (атака).
 */
function canEnter(state: MatchState, m: Mover, hex: HexId, isGoal: boolean): boolean {
  if (peaceBlocked(state, m.owner, hex)) return false;
  if (moveTerrain(state, hex) === null) return false;
  if (m.type === 'artillery' && state.hexes.owner[hex] !== m.owner) return false;
  if (isGoal) return true;
  if (isHostileHex(state, m.owner, hex)) return m.passHostile?.(hex) ?? false;
  return ownUnitsAt(state, m.owner, hex) < MAX_UNITS_PER_HEX;
}

const UNREACHED = 0x7fffffff;

interface SearchBuffers {
  readonly g: Int32Array;
  readonly prev: Int32Array;
  readonly generation: Uint32Array;
  readonly heap: MinHeap;
  currentGeneration: number;
}

const searchBuffers = new WeakMap<MatchState, SearchBuffers>();

function buffersFor(state: MatchState): SearchBuffers {
  const size = state.map.width * state.map.height;
  const current = searchBuffers.get(state);
  if (current) return current;
  const buffers: SearchBuffers = {
    g: new Int32Array(size),
    prev: new Int32Array(size),
    generation: new Uint32Array(size),
    heap: createHeap(),
    currentGeneration: 0,
  };
  searchBuffers.set(state, buffers);
  return buffers;
}

function beginSearch(buffers: SearchBuffers): void {
  buffers.currentGeneration += 1;
  if (buffers.currentGeneration === 0) {
    buffers.generation.fill(0);
    buffers.currentGeneration = 1;
  }
  buffers.heap.items.length = 0;
}

function distanceAt(buffers: SearchBuffers, hex: HexId): number {
  return buffers.generation[hex] === buffers.currentGeneration
    ? (buffers.g[hex] ?? UNREACHED)
    : UNREACHED;
}

// A* по времени хода; h — допустимая эвристика (0 — Дейкстра до ближайшей цели).
function search(
  state: MatchState,
  from: HexId,
  mover: Mover,
  isGoal: (hex: HexId) => boolean,
  h: (hex: HexId) => number,
  ownLand: LandRule = false,
  limit: number = UNREACHED,
): HexId[] | null {
  const { width, height } = state.map;
  const buffers = buffersFor(state);
  beginSearch(buffers);
  buffers.generation[from] = buffers.currentGeneration;
  buffers.g[from] = 0;
  buffers.prev[from] = -1;
  heapPush(buffers.heap, 0, from);
  let found = -1;
  for (let top = heapPop(buffers.heap); top; top = heapPop(buffers.heap)) {
    const hex = top[1];
    if (hex !== from && isGoal(hex)) {
      found = hex;
      break;
    }
    const gh = distanceAt(buffers, hex);
    for (const n of neighbors(hexFromId(hex, width))) {
      if (!inBounds(n, width, height)) continue;
      const id = hexId(n, width);
      if (!canEnter(state, mover, id, isGoal(id))) continue;
      const land = state.hexes.owner[id] ?? -1;
      if (ownLand === true && land !== mover.owner) continue;
      if (ownLand === 'safe' && land !== mover.owner && land >= 0) continue;
      const cost = stepTicks(state, mover, hex, id);
      if (cost === null || gh + cost >= distanceAt(buffers, id) || gh + cost > limit) continue;
      buffers.generation[id] = buffers.currentGeneration;
      buffers.g[id] = gh + cost;
      buffers.prev[id] = hex;
      heapPush(buffers.heap, gh + cost + h(id), id);
    }
  }
  if (found < 0) return null;
  const path: HexId[] = [];
  for (let at = found; at !== from; at = buffers.prev[at] ?? from) path.push(at);
  return path.reverse();
}

/** Правило земли для пути: любая, только своя (`true`) или своя и ничья (`'safe'`). */
export type LandRule = boolean | 'safe';

/**
 * Путь отряда (A* по времени хода, ничьи — по меньшему HexId). Снабжённость считается полной:
 * она меняет все шаги одинаково и на выбор пути не влияет. ownLand — только по своей земле (путь
 * к месту на линии плана); 'safe' — по своей и ничьей, но не по чужой.
 * @returns гексы после from до to включительно; [] при from === to; null — пути нет
 */
export function findPath(
  state: MatchState,
  from: HexId,
  to: HexId,
  type: UnitType,
  owner: number,
  ownLand: LandRule = false,
  passHostile?: (hex: HexId) => boolean,
): HexId[] | null {
  return computePath(state, from, to, type, owner, ownLand, passHostile);
}

function computePath(
  state: MatchState,
  from: HexId,
  to: HexId,
  type: UnitType,
  owner: number,
  ownLand: LandRule,
  passHostile: ((hex: HexId) => boolean) | undefined,
): HexId[] | null {
  const land = landPath(state, from, to, type, owner, ownLand, passHostile);
  const mover: Mover = { type, owner, supplyLevel: FP as Fp };
  const { width } = state.map;
  const straight = distance(hexFromId(from, width), hexFromId(to, width));
  let landTicks = UNREACHED;
  if (land) {
    landTicks = pathTicks(state, mover, from, land);
    // Море рассматривается, когда сушей приходится обходить горы и заливы: путь заметно длиннее прямой.
    if (2 * land.length <= 3 * straight + SEA_CONSIDER_SLACK) return land;
    // И в начале, и в конце пути должен быть свой порт не дальше, чем идти сушей.
    const ports = ownPortSet(state, owner);
    if (ports.size < 2 || !portsNear(state, ports, from, to, land.length)) return land;
  }
  // Звенья составного пути не дольше всего пути по суше: иначе морской путь не выиграет.
  const sea = seaPath(state, from, to, type, owner, ownLand, passHostile, landTicks);
  if (!sea) return land;
  if (!land) return sea;
  return pathTicks(state, mover, from, sea) < landTicks ? sea : land;
}

/** Запас в гексах: путь по суше не длиннее 1,5 прямой плюс столько — море не рассматривается. */
const SEA_CONSIDER_SLACK = 2;

/** Есть ли свои порты не дальше reach гексов и от начала, и от цели. */
function portsNear(
  state: MatchState,
  ports: ReadonlySet<HexId>,
  from: HexId,
  to: HexId,
  reach: number,
): boolean {
  const { width } = state.map;
  const a = hexFromId(from, width);
  const b = hexFromId(to, width);
  let nearFrom = false;
  let nearTo = false;
  for (const port of ports) {
    const at = hexFromId(port, width);
    if (distance(at, a) <= reach) nearFrom = true;
    if (distance(at, b) <= reach) nearTo = true;
  }
  return nearFrom && nearTo;
}

/** Время хода по пути, тики; шаг без прохода считается очень долгим. */
function pathTicks(state: MatchState, m: Mover, from: HexId, path: readonly HexId[]): number {
  let total = 0;
  let at = from;
  for (const hex of path) {
    total += stepTicks(state, m, at, hex) ?? UNREACHED_TICKS;
    at = hex;
  }
  return total;
}

const UNREACHED_TICKS = 100_000;

// Сушей: A* по времени хода.
function landPath(
  state: MatchState,
  from: HexId,
  to: HexId,
  type: UnitType,
  owner: number,
  ownLand: LandRule,
  passHostile: ((hex: HexId) => boolean) | undefined,
  limit: number = UNREACHED,
): HexId[] | null {
  if (from === to) return [];
  const mover: Mover = {
    type,
    owner,
    supplyLevel: FP as Fp,
    ...(passHostile ? { passHostile } : {}),
  };
  if (!canEnter(state, mover, to, true)) return null;
  const { width } = state.map;
  const goal = hexFromId(to, width);
  const hMin = minStepTicks(type);
  return search(
    state,
    from,
    mover,
    (hex) => hex === to,
    (hex) => distance(hexFromId(hex, width), goal) * hMin,
    ownLand,
    limit,
  );
}

// Составной путь: настоящий поиск по суше для звеньев и волна до ближайших портов (sea-path.ts).
function seaPath(
  state: MatchState,
  from: HexId,
  to: HexId,
  type: UnitType,
  owner: number,
  ownLand: LandRule,
  passHostile: ((hex: HexId) => boolean) | undefined,
  limit: number,
): HexId[] | null {
  if ((state.map.terrain[to] ?? 0) === TERRAIN.water) return null;
  const mover: Mover = {
    type,
    owner,
    supplyLevel: FP as Fp,
    ...(passHostile ? { passHostile } : {}),
  };
  return composeSeaPath(
    state,
    owner,
    from,
    to,
    {
      flood: (start, ports, want, cap) =>
        floodPorts(state, start, mover, ownLand, ports, want, cap),
      leg: (a, b, cap) => landPath(state, a, b, type, owner, ownLand, passHostile, cap),
    },
    limit,
  );
}

// Волна Дейкстры от гекса: останавливается, найдя want ближайших портов; порты — по времени хода.
function floodPorts(
  state: MatchState,
  from: HexId,
  mover: Mover,
  ownLand: LandRule,
  ports: ReadonlySet<HexId>,
  want: number,
  limit: number,
): Map<HexId, number> {
  const { width, height } = state.map;
  const buffers = buffersFor(state);
  beginSearch(buffers);
  buffers.generation[from] = buffers.currentGeneration;
  buffers.g[from] = 0;
  heapPush(buffers.heap, 0, from);
  const found = new Map<HexId, number>();
  for (let top = heapPop(buffers.heap); top; top = heapPop(buffers.heap)) {
    const hex = top[1];
    const gh = distanceAt(buffers, hex);
    if (top[0] > gh) continue;
    if (ports.has(hex)) {
      found.set(hex, gh);
      if (found.size >= want) break;
    }
    for (const n of neighbors(hexFromId(hex, width))) {
      if (!inBounds(n, width, height)) continue;
      const id = hexId(n, width);
      if (!canEnter(state, mover, id, false)) continue;
      const land = state.hexes.owner[id] ?? -1;
      if (ownLand === true && land !== mover.owner) continue;
      if (ownLand === 'safe' && land !== mover.owner && land >= 0) continue;
      const cost = stepTicks(state, mover, hex, id);
      if (cost === null || gh + cost >= distanceAt(buffers, id) || gh + cost > limit) continue;
      buffers.generation[id] = buffers.currentGeneration;
      buffers.g[id] = gh + cost;
      heapPush(buffers.heap, gh + cost, id);
    }
  }
  return found;
}

/**
 * Путь до ближайшего по времени хода гекса, удовлетворяющего isGoal (Дейкстра).
 * @returns гексы после from до цели включительно или null, если цели не достичь
 */
export function findNearestPath(
  state: MatchState,
  from: HexId,
  type: UnitType,
  owner: number,
  isGoal: (hex: HexId) => boolean,
): HexId[] | null {
  const mover: Mover = { type, owner, supplyLevel: FP as Fp };
  return search(state, from, mover, isGoal, () => 0);
}
