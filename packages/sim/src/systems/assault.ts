// Штурм городов и добор резерва направлением (07-controls.md, «Меню страны»). Командир направления
// не оставляет по одному отряду у города, который им не взять: на вражеский город идёт минимальная
// группа, которой прогноз боя обещает победу, а свободный резерв игрока вливается в наступающую
// армию, а не стоит в тылу. Только армии с направлением `attack`; людям автоматика не включается.
import {
  ASSAULT_MAX_UNITS,
  POCKET_MAX_LAND,
  ASSAULT_GAP,
  ASSAULT_REACH,
  OFFENSIVE_STOP_ORG,
  TICKS_PER_S,
  ASSAULT_PERIOD_S,
} from '../balance.ts';
import { blocOf } from '../commands/launch.ts';
import { executeUnitCommand, validateUnitCommand } from '../commands/unit.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId } from '../math/hex.ts';
import { forecastInState } from '../queries/forecast.ts';
import { findPath, isHostileHex } from '../queries/unit-path.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { planHexes } from '../state/front.ts';
import { adjacentHexes, holeComponents } from '../state/offensive-steps.ts';
import { atWar } from '../state/relations.ts';
import type { Army, MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/** Столица ценнее обычного города: её потеря переносит столицу и бьёт по экономике. */
const CAPITAL_VALUE_MULT = 2;

const ready = (u: Unit): boolean =>
  u.order === 'idle' && !u.inBattle && u.type !== 'artillery' && u.org >= OFFENSIVE_STOP_ORG;

// Есть ли свой гекс не дальше ASSAULT_GAP гексов от города: далёкий город не штурмуют — иначе отряд
// тянул бы червя по чужой земле, а не наступал сплошным фронтом.
function nearOwn(state: MatchState, hex: number, owner: number): boolean {
  let ring: number[] = [hex];
  const seen = new Set<number>(ring);
  for (let step = 0; step < ASSAULT_GAP; step += 1) {
    const nextRing: number[] = [];
    for (const h of ring) {
      for (const n of adjacentHexes(state, h)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (state.hexes.owner[n] === owner) return true;
        nextRing.push(n);
      }
    }
    ring = nextRing;
  }
  return false;
}

/**
 * Группы штурма: по каждому вражескому городу блока цели (по пользе: ценность / расстояние)
 * ближайшие готовые отряды армии, минимальный набор которых по прогнозу побеждает.
 */
function assault(state: MatchState, army: Army): void {
  const dir = army.dir;
  if (!dir || dir.mode !== 'attack' || dir.target < 0) return;
  const enemy = blocOf(state, army.owner, dir.target);
  const { width } = state.map;
  const at = (hex: number) => hexFromId(hex, width);
  const mine = allUnits(state).filter((u) => u.armyId === army.id);
  const busy = new Set(
    mine
      .filter((u) => u.order === 'attack' || u.path.length > 0)
      .map((u) => (u.order === 'attack' ? u.target : (u.path.at(-1) ?? -1))),
  );
  const free = mine.filter(ready);
  const used = new Set<number>();
  const ranked = state.cities
    .filter((c) => enemy(c.owner) && !busy.has(c.hex) && nearOwn(state, c.hex, army.owner))
    .map((c) => ({
      city: c,
      value: c.level * (c.id === state.players[c.owner]?.capitalCityId ? CAPITAL_VALUE_MULT : 1),
      near: Math.min(...free.map((u) => distance(at(u.hex), at(c.hex))), Number.MAX_SAFE_INTEGER),
    }))
    .filter((t) => t.near <= ASSAULT_REACH)
    .sort((a, b) => b.value * (a.near + 1) - a.value * (b.near + 1) || a.city.hex - b.city.hex);
  for (const target of ranked) {
    const pool = free
      .filter((u) => !used.has(u.id))
      .sort(
        (a, b) =>
          distance(at(a.hex), at(target.city.hex)) - distance(at(b.hex), at(target.city.hex)) ||
          a.id - b.id,
      );
    const force: Unit[] = [];
    for (const unit of pool.slice(0, ASSAULT_MAX_UNITS)) {
      force.push(unit);
      if (forecastInState(state, force, target.city.hex).outcome !== 'victory') continue;
      const cmd = {
        t: 'attack',
        unitIds: force.map((u) => u.id),
        target: target.city.hex,
      } as const;
      if (validateUnitCommand(state, army.owner, cmd).ok) {
        executeUnitCommand(state, army.owner, cmd);
        for (const u of force) used.add(u.id);
      }
      break;
    }
  }
}

/** Группа на котёл с врагом крупнее штурмовой: котёл надо закрыть, а не держать рядом войска. */
const POCKET_MAX_UNITS = 16;
/** Котёл прилегает к своей земле, червя не будет: отряды берутся и издалека. */
const POCKET_REACH = 20;
/** Сколько гексов котла ставится в работу за одно решение. */
const POCKET_BATCH = 8;

/**
 * Оторванные куски врага: связные (по его гексам) куски земли воюющего игрока, не содержащие его
 * столицу, — любого размера, не только окружённые целиком своей землёй. Кусок у кромки воды или
 * границы карты, куда столица не дотягивается, — тоже котёл. Нет столицы — главным считается
 * самый большой кусок.
 * @returns куски — гексы по возрастанию HexId
 */
function cutOffPieces(state: MatchState, owner: number): number[][] {
  const out: number[][] = [];
  for (const p of state.players) {
    if (p.id === owner || p.status !== 'alive' || !atWar(state, owner, p.id)) continue;
    const mine = (h: number): boolean =>
      state.hexes.owner[h] === p.id && state.map.terrain[h] !== TERRAIN.water;
    const seen = new Set<number>();
    const pieces: number[][] = [];
    for (let start = 0; start < state.hexes.owner.length; start += 1) {
      if (seen.has(start) || !mine(start)) continue;
      const piece = [start];
      seen.add(start);
      for (let i = 0; i < piece.length; i += 1) {
        for (const n of adjacentHexes(state, piece[i] as number)) {
          if (seen.has(n) || !mine(n)) continue;
          seen.add(n);
          piece.push(n);
        }
      }
      pieces.push(piece.sort((x, y) => x - y));
    }
    if (pieces.length < 2) continue;
    const capital = state.cities.find((c) => c.id === p.capitalCityId)?.hex;
    const main =
      pieces.find((piece) => capital !== undefined && piece.includes(capital)) ??
      [...pieces].sort((a, b) => b.length - a.length)[0];
    out.push(...pieces.filter((piece) => piece !== main));
  }
  return out;
}

/**
 * Закрытие котлов: чужие и ничьи куски внутри своей земли берутся независимо от линии наступления.
 * Заходят гексы котла, прилегающие к своей земле: пустой гекс — одним отрядом, гекс с врагом —
 * минимальной группой, которой прогноз боя обещает победу. Котёл съедается слоями, как анклав.
 */
function closePockets(state: MatchState, owner: number, armies: readonly Army[]): void {
  const ids = new Set(armies.map((a) => a.id));
  const free = allUnits(state).filter(
    (u) => u.owner === owner && u.armyId !== null && ids.has(u.armyId) && ready(u),
  );
  if (free.length === 0) return;
  const { width } = state.map;
  const at = (hex: number) => hexFromId(hex, width);
  const heading = new Set(
    allUnits(state)
      .filter((u) => u.owner === owner)
      .map((u) => (u.order === 'attack' ? u.target : (u.path.at(-1) ?? -1))),
  );
  const own = (h: number): boolean => state.hexes.owner[h] === owner;
  const targets: number[] = [];
  for (const hole of [
    ...holeComponents(state, owner, POCKET_MAX_LAND),
    ...cutOffPieces(state, owner),
  ]) {
    for (const h of hole) {
      if (heading.has(h)) continue;
      const touches = adjacentHexes(state, h).some(own);
      if (touches) targets.push(h);
    }
  }
  const used = new Set<number>();
  for (const hex of [...new Set(targets)].slice(0, POCKET_BATCH)) {
    const pool = free
      .filter((u) => !used.has(u.id) && distance(at(u.hex), at(hex)) <= POCKET_REACH)
      .sort((a, b) => distance(at(a.hex), at(hex)) - distance(at(b.hex), at(hex)) || a.id - b.id);
    const hostile = isHostileHex(state, owner, hex);
    const force: Unit[] = [];
    for (const unit of pool.slice(0, hostile ? POCKET_MAX_UNITS : 1)) {
      force.push(unit);
      if (hostile && forecastInState(state, force, hex).outcome !== 'victory') continue;
      const cmd = hostile
        ? ({ t: 'attack', unitIds: force.map((u) => u.id), target: hex } as const)
        : ({ t: 'move', unitIds: [unit.id], to: hex } as const);
      if (validateUnitCommand(state, owner, cmd).ok) {
        executeUnitCommand(state, owner, cmd);
        for (const u of force) used.add(u.id);
      }
      break;
    }
  }
}

/** Резерв ближе этого числа гексов к фронту стоит где стоит; дальше — подтягивается. */
const STAGE_RANGE = 3;
/** Сколько отрядов резерва командир подтягивает за раз. */
const STAGE_BATCH = 6;

/**
 * Резерв — у фронта, а не в тылу: стоящие отряды без армии, далёкие от границы с врагом, идут к
 * ближайшему своему гексу у неё и ждут там: оттуда они вливаются в армии и затыкают прорывы
 * вместо того, чтобы тратить минуты на дорогу из глубины страны.
 */
function stageReserve(state: MatchState, owner: number): void {
  const { width } = state.map;
  const at = (hex: number) => hexFromId(hex, width);
  const front: number[] = [];
  state.hexes.owner.forEach((o, h) => {
    if (o !== owner) return;
    const touches = adjacentHexes(state, h).some((n) => {
      const other = state.hexes.owner[n] ?? -1;
      return other >= 0 && other !== owner && atWar(state, owner, other);
    });
    if (touches) front.push(h);
  });
  if (front.length === 0) return;
  const reserve = allUnits(state).filter(
    (u) =>
      u.owner === owner &&
      u.armyId === null &&
      u.type !== 'artillery' &&
      u.order === 'idle' &&
      !u.inBattle &&
      u.slot !== SLOT_DETACHED,
  );
  let sent = 0;
  for (const u of reserve) {
    if (sent >= STAGE_BATCH) return;
    let best = front[0] as number;
    let bestD = Number.MAX_SAFE_INTEGER;
    for (const h of front) {
      const d = distance(at(u.hex), at(h));
      if (d < bestD) {
        best = h;
        bestD = d;
      }
    }
    if (bestD <= STAGE_RANGE) continue;
    const path =
      findPath(state, u.hex, best, u.type, owner, true) ??
      findPath(state, u.hex, best, u.type, owner, 'safe');
    if (!path || path.length === 0) continue;
    u.path = path;
    u.moveTicks = 0;
    u.moveTotal = 0;
    u.slot = -1;
    u.order = 'move';
    sent += 1;
  }
}

// Свободный резерв игрока вливается в ближайшую к нему наступающую армию: заказ — минимум,
// а отряды в тылу без дела — потеря силы.
function deployReserve(state: MatchState, owner: number, attackers: readonly Army[]): void {
  const { width } = state.map;
  const targets = attackers.map((a) => {
    const plan = state.plans.find((p) => p.armyId === a.id);
    return { army: a, hexes: plan ? planHexes(state, plan) : [] };
  });
  for (const u of allUnits(state)) {
    if (u.owner !== owner || u.armyId !== null || u.type === 'artillery') continue;
    if (u.order !== 'idle' || u.inBattle || u.slot === SLOT_DETACHED) continue;
    let best: { readonly id: number; readonly gap: number } | null = null;
    for (const t of targets) {
      if (t.hexes.length === 0) continue;
      const gap = Math.min(
        ...t.hexes.map((h) => distance(hexFromId(u.hex, width), hexFromId(h, width))),
      );
      if (!best || gap < best.gap || (gap === best.gap && t.army.id < best.id)) {
        best = { id: t.army.id, gap };
      }
    }
    if (best) u.armyId = best.id;
  }
}

/** Штурм городов и вливание резерва в наступающие армии направлений; раз в ASSAULT_PERIOD_S секунд. */
export function commandAssaults(state: MatchState): void {
  if (state.tick % (ASSAULT_PERIOD_S * TICKS_PER_S) !== 0) return;
  const byOwner = new Map<number, Army[]>();
  for (const army of state.armies) {
    if (army.dir?.mode !== 'attack' || army.dir.target < 0) continue;
    const list = byOwner.get(army.owner);
    if (list) list.push(army);
    else byOwner.set(army.owner, [army]);
  }
  for (const [owner, armies] of byOwner) {
    deployReserve(state, owner, armies);
    for (const army of armies) assault(state, army);
    closePockets(state, owner, armies);
  }
  // Резерв подтягивается к фронту у игроков с приказами направлений (раз в четыре решения).
  if (state.tick % (ASSAULT_PERIOD_S * TICKS_PER_S * 4) !== 0) return;
  const owners = new Set(
    state.armies
      .filter((a) => a.dir && a.dir.mode !== 'idle' && a.dir.target >= 0)
      .map((a) => a.owner),
  );
  for (const owner of [...owners].sort((a, b) => a - b)) stageReserve(state, owner);
}
