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

/** Зона контроля: рядом с гексом стоит отряд другого игрока. */
function inEnemyZoc(state: MatchState, owner: number, hex: HexId): boolean {
  const { width, height } = state.map;
  for (const n of neighbors(hexFromId(hex, width))) {
    if (!inBounds(n, width, height)) continue;
    const id = hexId(n, width);
    if ((unitIndex(state).unitsByHex[id] ?? []).some((unit) => atWar(state, owner, unit.owner))) {
      return true;
    }
  }
  return false;
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
  // Вода доступна только плывущему отряду, и проход по ней одинаково быстр.
  if ((state.map.terrain[to] ?? 0) === TERRAIN.water) {
    return m.sea ? Math.max(1, intDiv(SEA_MOVE_S_PER_HEX * TICKS_PER_S, FP)) : null;
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
      if (cost === null || gh + cost >= distanceAt(buffers, id)) continue;
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
  );
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
