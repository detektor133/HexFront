// Путь и время перехода армий: A* по времени хода, стабильные ничьи по HexId.
// GDD: docs/gdd/05-armies.md — «Движение», «Захват»; 01-map.md — «Местность».
import {
  ATTRITION_THRESHOLD,
  LOW_SUPPLY_SPEED_MULT,
  MAX_ARMIES_PER_HEX,
  MOVE_TIME_S,
  RIVER_MOVE_PENALTY_S,
  ROAD_MOVE_MULT,
  SPEED,
  TICKS_PER_S,
  ZOC_MOVE_MULT,
  type LandTerrain,
  type UnitType,
} from '../balance.ts';
import { FEATURE, TERRAIN, TERRAIN_NAMES } from '../map/types.ts';
import { createHeap, heapPop, heapPush } from '../math/heap.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { FP, fpDiv, fpMul, intDiv, type Fp } from '../math/int.ts';
import { NEUTRAL, type MatchState } from '../state/types.ts';

/** Местность для времени хода: перевал — как холмы; null — вода. */
function moveTerrain(state: MatchState, hex: HexId): LandTerrain | null {
  const code = state.map.terrain[hex] ?? TERRAIN.water;
  if (code === TERRAIN.water) return null;
  if (code === TERRAIN.mountains && state.map.features[hex] === FEATURE.pass) return 'hills';
  const name = TERRAIN_NAMES[code];
  return name === undefined || name === 'water' ? null : name;
}

/** Сколько армий игрока стоит в гексе. */
export function ownArmiesAt(state: MatchState, owner: number, hex: HexId): number {
  let n = 0;
  for (const a of state.armies) if (a.owner === owner && a.hex === hex) n += 1;
  return n;
}

/**
 * Гекс занят врагом: вражеская армия, ополчение чужого города или гарнизон нейтрального.
 * Войти в такой гекс можно только через бой.
 */
export function isHostileHex(state: MatchState, owner: number, hex: HexId): boolean {
  if (state.armies.some((a) => a.hex === hex && a.owner !== owner)) return true;
  const city = state.cities.find((c) => c.hex === hex);
  if (!city || city.owner === owner) return false;
  return city.owner !== NEUTRAL || city.garrison > 0;
}

/** Зона контроля: рядом с гексом стоит армия другого игрока. */
function inEnemyZoc(state: MatchState, owner: number, hex: HexId): boolean {
  const { width, height } = state.map;
  for (const n of neighbors(hexFromId(hex, width))) {
    if (!inBounds(n, width, height)) continue;
    const id = hexId(n, width);
    if (state.armies.some((a) => a.hex === id && a.owner !== owner)) return true;
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
}

/**
 * Время перехода между соседними гексами:
 * MOVE_TIME_S / SPEED × ROAD_MOVE_MULT (оба гекса дорожные) + RIVER_MOVE_PENALTY_S (река на ребре),
 * × ZOC_MOVE_MULT (назначение рядом с врагом), ÷ LOW_SUPPLY_SPEED_MULT (снабжение < 50 %).
 * @returns тики, не меньше 1; null — гекс непроходим или не сосед
 */
export function stepTicks(state: MatchState, m: Mover, from: HexId, to: HexId): number | null {
  const terrain = moveTerrain(state, to);
  const dir = directionTo(state, from, to);
  if (terrain === null || dir < 0) return null;
  let t = fpDiv(MOVE_TIME_S[terrain], SPEED[m.type][terrain]);
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
 * Можно ли армии войти в гекс по пути. Артиллерия — только в свои гексы; промежуточные гексы
 * не должны быть заняты врагом или заполнены своими армиями; цель может быть вражеской (атака).
 */
function canEnter(state: MatchState, m: Mover, hex: HexId, isGoal: boolean): boolean {
  if (moveTerrain(state, hex) === null) return false;
  if (m.type === 'artillery' && state.hexes.owner[hex] !== m.owner) return false;
  if (isGoal) return true;
  if (isHostileHex(state, m.owner, hex)) return false;
  return ownArmiesAt(state, m.owner, hex) < MAX_ARMIES_PER_HEX;
}

const UNREACHED = 0x7fffffff;

/**
 * Путь армии (A* по времени хода, ничьи — по меньшему HexId). Снабжённость считается полной:
 * она меняет все шаги одинаково и на выбор пути не влияет.
 * @returns гексы после from до to включительно; [] при from === to; null — пути нет
 */
export function findPath(
  state: MatchState,
  from: HexId,
  to: HexId,
  type: UnitType,
  owner: number,
): HexId[] | null {
  if (from === to) return [];
  const { width, height } = state.map;
  const mover: Mover = { type, owner, supplyLevel: FP as Fp };
  if (!canEnter(state, mover, to, true)) return null;
  const goal = hexFromId(to, width);
  const hMin = minStepTicks(type);
  const g = new Int32Array(width * height).fill(UNREACHED);
  const prev = new Int32Array(width * height).fill(-1);
  const heap = createHeap();
  g[from] = 0;
  heapPush(heap, 0, from);
  for (let top = heapPop(heap); top; top = heapPop(heap)) {
    const hex = top[1];
    if (hex === to) break;
    const gh = g[hex] ?? UNREACHED;
    for (const n of neighbors(hexFromId(hex, width))) {
      if (!inBounds(n, width, height)) continue;
      const id = hexId(n, width);
      if (!canEnter(state, mover, id, id === to)) continue;
      const cost = stepTicks(state, mover, hex, id);
      if (cost === null || gh + cost >= (g[id] ?? UNREACHED)) continue;
      g[id] = gh + cost;
      prev[id] = hex;
      heapPush(heap, gh + cost + distance(n, goal) * hMin, id);
    }
  }
  if (prev[to] === -1) return null;
  const path: HexId[] = [];
  for (let at = to; at !== from; at = prev[at] ?? from) path.push(at);
  return path.reverse();
}
