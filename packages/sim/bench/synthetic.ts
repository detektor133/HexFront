// Синтетический матч для бенчмарка step (03/T11): 30 игроков, 80 × 50 = 4000 гексов,
// 200 отрядов, 20 боёв. Состояние собирается напрямую — это замер, а не сценарий механики.
import { ORG_MAX, type UnitType } from '../src/balance.ts';
import type { PlayerCommand } from '../src/commands/types.ts';
import { TERRAIN, type MapStatic } from '../src/map/types.ts';
import {
  distance,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  offsetToAxial,
  spiral,
  type Hex,
  type HexId,
} from '../src/math/hex.ts';
import { FP, type Fp } from '../src/math/int.ts';
import { findPath } from '../src/queries/unit-path.ts';
import { createMatch } from '../src/state/create-match.ts';
import { recomputeAllNetworks } from '../src/state/network.ts';
import type { MatchState, Unit } from '../src/state/types.ts';

export const WIDTH = 80;
export const HEIGHT = 50;
export const PLAYERS = 30;
export const UNITS = 200;
export const BATTLES = 20;

// Спавны сеткой 6 × 5, нейтральные города — между ними.
function buildMap(): MapStatic {
  const size = WIDTH * HEIGHT;
  const terrain = new Uint8Array(size).fill(TERRAIN.plains);
  for (let id = 0; id < size; id += 1) {
    // Детерминированная пестрота рельефа: лес и холмы полосами.
    if (id % 7 === 3) terrain[id] = TERRAIN.forest;
    if (id % 11 === 5) terrain[id] = TERRAIN.hills;
  }
  const spawns: Hex[] = [];
  for (let gy = 0; gy < 5; gy += 1) {
    for (let gx = 0; gx < 6; gx += 1) {
      spawns.push(offsetToAxial({ col: 7 + gx * 13, row: 5 + gy * 10 }));
    }
  }
  const cities = [];
  for (let gy = 0; gy < 4; gy += 1) {
    for (let gx = 0; gx < 6; gx += 1) {
      const h = offsetToAxial({ col: 13 + gx * 13, row: 10 + gy * 10 });
      const i = gy * 6 + gx;
      cities.push({
        id: 1000 + i,
        q: h.q,
        r: h.r,
        name: `N${i}`,
        level: 1 + (i % 3),
        garrison: 150,
      });
    }
  }
  return {
    version: 1,
    id: 'bench',
    width: WIDTH,
    height: HEIGHT,
    terrain,
    features: new Uint8Array(size),
    rivers: new Uint8Array(size),
    roads: new Uint8Array(size),
    cities,
    spawns,
  };
}

// Вся суша делится между игроками по ближайшей столице; у столиц — дороги в радиусе 2.
function partition(state: MatchState): void {
  const { width } = state.map;
  const capitals = state.players.map((p) => {
    const c = state.cities.find((x) => x.id === p.capitalCityId);
    return c ? hexFromId(c.hex, width) : { q: 0, r: 0 };
  });
  state.hexes.owner.forEach((_, id) => {
    const h = hexFromId(id, width);
    let best = 0;
    capitals.forEach((c, i) => {
      if (distance(h, c) < distance(h, capitals[best] ?? c)) best = i;
    });
    if (!state.cities.some((c) => c.hex === id && c.owner < 0)) state.hexes.owner[id] = best;
  });
  for (const c of capitals) {
    for (const h of spiral(c, 2))
      if (inBounds(h, width, HEIGHT)) state.hexes.road[hexId(h, width)] = 1;
  }
}

function unit(
  state: MatchState,
  owner: number,
  type: UnitType,
  hex: HexId,
  soldiers: number,
): Unit {
  const u: Unit = {
    id: state.nextId,
    owner,
    type,
    soldiers: (soldiers * FP) as Fp,
    org: ORG_MAX,
    hex,
    order: 'idle',
    supplyLevel: FP as Fp,
    path: [],
    moveTicks: 0,
    moveTotal: 0,
    armyId: null,
    lowSupplyTicks: 0,
    encircled: false,
    target: -1,
    inBattle: false,
    focus: -1,
    fireTarget: -1,
  };
  state.nextId += 1;
  state.units.push(u);
  return u;
}

/** Участники боя на границе: обе стороны, чтобы бои не затухали. */
export interface Front {
  readonly units: readonly number[];
}

// 20 боёв на границах соседних игроков: по 2 отряда с каждой стороны.
function battles(state: MatchState): Front[] {
  const { width } = state.map;
  const fronts: Front[] = [];
  const used = new Set<number>();
  for (let id = 0; id < state.hexes.owner.length && fronts.length < BATTLES; id += 1) {
    const a = state.hexes.owner[id] ?? -1;
    if (a < 0 || used.has(a) || state.cities.some((c) => c.hex === id)) continue;
    for (const n of neighbors(hexFromId(id, width))) {
      if (!inBounds(n, width, HEIGHT)) continue;
      const nid = hexId(n, width);
      const b = state.hexes.owner[nid] ?? -1;
      if (b < 0 || b === a || used.has(b) || state.cities.some((c) => c.hex === nid)) continue;
      const att = [unit(state, a, 'infantry', id, 900), unit(state, a, 'armor', id, 300)];
      const def = [unit(state, b, 'infantry', id === nid ? id : nid, 800)];
      def.push(unit(state, b, 'artillery', nid, 200));
      for (const u of att) {
        u.order = 'attack';
        u.target = nid;
      }
      fronts.push({ units: [...att, ...def].map((u) => u.id) });
      used.add(a);
      used.add(b);
      break;
    }
  }
  return fronts;
}

/** Синтетический матч и его фронты. */
export function syntheticMatch(): { state: MatchState; fronts: Front[] } {
  const state = createMatch(
    buildMap(),
    Array.from({ length: PLAYERS }, (_, i) => ({ name: `P${i}` })),
    7,
  );
  partition(state);
  const fronts = battles(state);
  // Остальные отряды — в тылу, половина идёт маршем по своей земле.
  let i = 0;
  while (state.units.length < UNITS) {
    const owner = i % PLAYERS;
    const own = state.hexes.owner.findIndex((o, id) => o === owner && id % 3 === i % 3);
    const u = unit(state, owner, i % 4 === 0 ? 'artillery' : 'infantry', own, 300);
    // Каждый второй тыловой отряд идёт маршем к своей столице.
    const capital = state.cities.find((c) => c.id === state.players[owner]?.capitalCityId);
    const path = i % 2 === 0 && capital ? findPath(state, own, capital.hex, u.type, owner) : null;
    if (path && path.length > 0) {
      u.path = path;
      u.order = 'move';
    }
    i += 1;
  }
  state.units.sort((a, b) => a.id - b.id);
  recomputeAllNetworks(state);
  return { state, fronts };
}

// Соседний вражеский гекс для атаки: сначала с вражескими отрядами, затем любой чужой.
function nextTarget(state: MatchState, u: Unit): HexId | null {
  const { width } = state.map;
  let fallback: HexId | null = null;
  for (const n of neighbors(hexFromId(u.hex, width))) {
    if (!inBounds(n, width, HEIGHT)) continue;
    const id = hexId(n, width);
    const owner = state.hexes.owner[id] ?? -1;
    if (owner < 0 || owner === u.owner || state.map.terrain[id] === TERRAIN.water) continue;
    if (state.units.some((x) => x.hex === id && x.owner !== u.owner)) return id;
    fallback ??= id;
  }
  return fallback;
}

/** Команды, возвращающие в бой участников фронтов, вышедших из него (обе стороны). */
export function rearm(state: MatchState, fronts: readonly Front[]): PlayerCommand[] {
  const out: PlayerCommand[] = [];
  for (const f of fronts) {
    for (const id of f.units) {
      const u = state.units.find((x) => x.id === id);
      if (!u || u.order !== 'idle' || u.type === 'artillery') continue;
      const target = nextTarget(state, u);
      if (target !== null)
        out.push({ playerId: u.owner, cmd: { t: 'attack', unitIds: [id], target } });
    }
  }
  return out;
}
