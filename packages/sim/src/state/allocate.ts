// Расчёт мест отрядов армии на линии плана (CR-002): вес угрозы, равномерность при равной
// угрозе, броня на равнину, артиллерия позади линии. Состояние не меняет.
// GDD: docs/gdd/07-controls.md — «Распределение».
import { ARTY_RANGE, MAX_UNITS_PER_HEX } from '../balance.ts';
import { planHexes } from './front.ts';
import type { ArmyPlan, MatchState, Unit } from './types.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';

/** Вес угрозы считается в сотнях вражеских солдат (07-controls.md). */
const THREAT_SOLDIERS = 100;

/** Места отрядов армии и покрытие (сумма весов занятых гексов линии и под огнём артиллерии). */
export interface Allocation {
  readonly slots: ReadonlyMap<number, HexId>;
  readonly coverage: number;
  readonly line: readonly HexId[];
  /** Вес гекса линии, fixed-point. */
  readonly weight: ReadonlyMap<HexId, number>;
}

function around(state: MatchState, hex: HexId): HexId[] {
  const { width, height } = state.map;
  return neighbors(hexFromId(hex, width))
    .filter((n) => inBounds(n, width, height))
    .map((n) => hexId(n, width));
}

/** Вес гекса линии: FP + вражеские солдаты на соседних гексах, в сотнях. */
function weights(state: MatchState, owner: number, line: readonly HexId[]): Map<HexId, number> {
  const out = new Map<HexId, number>();
  for (const h of line) {
    const near = new Set(around(state, h));
    let enemy = 0;
    for (const u of state.units) if (u.owner !== owner && near.has(u.hex)) enemy += u.soldiers;
    out.set(h, FP + intDiv(enemy, THREAT_SOLDIERS));
  }
  return out;
}

/** Отряд армии, которым сейчас может распоряжаться план. */
export function planControls(u: Unit, armyId: number): boolean {
  if (u.armyId !== armyId || u.order === 'retreat') return false;
  return u.order === 'idle' || (u.order === 'move' && u.slot >= 0);
}

// Гексы линии для n отрядов: n ≤ M — самые угрожаемые, при равенстве — равномерно вдоль линии;
// n > M — все гексы и вторые/третьи места на самых угрожаемых.
function lineSlots(
  line: readonly HexId[],
  w: Map<HexId, number>,
  n: number,
  cap: (h: HexId) => number,
): HexId[] {
  const m = line.length;
  if (m === 0 || n === 0) return [];
  const even = new Set<number>();
  for (let k = 0; k < Math.min(n, m); k += 1) even.add(intDiv((2 * k + 1) * m, 2 * Math.min(n, m)));
  const order = line
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => cap(h) > 0)
    .sort(
      (a, b) =>
        (w.get(b.h) ?? 0) - (w.get(a.h) ?? 0) ||
        Number(!even.has(a.i)) - Number(!even.has(b.i)) ||
        a.i - b.i,
    );
  const out: HexId[] = [];
  const used = new Map<HexId, number>();
  for (let round = 0; out.length < n && round < MAX_UNITS_PER_HEX; round += 1) {
    for (const { h } of order) {
      if (out.length >= n) break;
      if ((used.get(h) ?? 0) >= cap(h)) continue;
      used.set(h, (used.get(h) ?? 0) + 1);
      out.push(h);
    }
  }
  return out;
}

// Место — ближайшему подходящему отряду: на равнину — броне, на прочую местность — пехоте.
function assignLine(
  state: MatchState,
  slots: HexId[],
  units: Unit[],
  w: Map<HexId, number>,
): Map<number, HexId> {
  const { width } = state.map;
  const free = [...units];
  const out = new Map<number, HexId>();
  const sorted = [...slots].sort((a, b) => (w.get(b) ?? 0) - (w.get(a) ?? 0) || a - b);
  for (const h of sorted) {
    const plains = state.map.terrain[h] === TERRAIN.plains;
    const wanted = plains ? 'armor' : 'infantry';
    const pool = free.some((u) => u.type === wanted) ? free.filter((u) => u.type === wanted) : free;
    const at = hexFromId(h, width);
    pool.sort(
      (a, b) =>
        distance(hexFromId(a.hex, width), at) - distance(hexFromId(b.hex, width), at) ||
        a.id - b.id,
    );
    const pick = pool[0];
    if (!pick) break;
    out.set(pick.id, h);
    free.splice(free.indexOf(pick), 1);
  }
  return out;
}

// Артиллерия — на свой гекс позади линии (рядом с линией, не на ней, не у чужой земли),
// с наибольшим ещё не покрытым весом линии в радиусе ARTY_RANGE.
function assignArtillery(
  state: MatchState,
  owner: number,
  arty: Unit[],
  line: readonly HexId[],
  w: Map<HexId, number>,
): { slots: Map<number, HexId>; covered: number } {
  const { width } = state.map;
  const onLine = new Set(line);
  const candidates = new Set<HexId>();
  for (const h of line) {
    for (const n of around(state, h)) {
      if (onLine.has(n) || state.hexes.owner[n] !== owner || state.map.terrain[n] === TERRAIN.water)
        continue;
      if (
        around(state, n).some(
          (x) => (state.hexes.owner[x] ?? -1) >= 0 && state.hexes.owner[x] !== owner,
        )
      )
        continue;
      candidates.add(n);
    }
  }
  const covered = new Set<HexId>();
  const slots = new Map<number, HexId>();
  let total = 0;
  for (const a of arty) {
    let best: HexId | undefined;
    let bestGain = -1;
    for (const c of [...candidates].sort((x, y) => x - y)) {
      const at = hexFromId(c, width);
      const gain = line
        .filter((h) => !covered.has(h) && distance(hexFromId(h, width), at) <= ARTY_RANGE)
        .reduce((s, h) => s + (w.get(h) ?? 0), 0);
      const closer =
        best !== undefined &&
        distance(hexFromId(a.hex, width), at) <
          distance(hexFromId(a.hex, width), hexFromId(best, width));
      if (gain > bestGain || (gain === bestGain && closer)) {
        best = c;
        bestGain = gain;
      }
    }
    if (best === undefined) break;
    slots.set(a.id, best);
    const at = hexFromId(best, width);
    for (const h of line) if (distance(hexFromId(h, width), at) <= ARTY_RANGE) covered.add(h);
    total += Math.max(0, bestGain);
  }
  return { slots, covered: total };
}

/**
 * Места для отрядов армии, которыми распоряжается план (идут по месту или стоят).
 * @returns места по id отряда, покрытие, гексы и веса линии
 */
export function allocate(state: MatchState, plan: ArmyPlan, owner: number): Allocation {
  const line = planHexes(state, plan);
  const w = weights(state, owner, line);
  const units = state.units.filter((u) => planControls(u, plan.armyId));
  const lineUnits = units.filter((u) => u.type !== 'artillery');
  const arty = units.filter((u) => u.type === 'artillery');
  // Место в гексе занимают и чужие для плана свои отряды (другие армии, резерв).
  const cap = (h: HexId): number =>
    MAX_UNITS_PER_HEX -
    state.units.filter((u) => u.owner === owner && u.hex === h && !units.includes(u)).length;
  const slots = new Map(assignLine(state, lineSlots(line, w, lineUnits.length, cap), lineUnits, w));
  const art = assignArtillery(state, owner, arty, line, w);
  for (const [id, h] of art.slots) slots.set(id, h);
  const occupied = new Set(slots.values());
  const lineCoverage = line.filter((h) => occupied.has(h)).reduce((s, h) => s + (w.get(h) ?? 0), 0);
  return { slots, coverage: lineCoverage + art.covered, line, weight: w };
}

/**
 * Покрытие текущих мест отрядов (для порога перестановки): занятые гексы линии и вес линии под
 * огнём артиллерии.
 */
export function currentCoverage(state: MatchState, a: Allocation, units: readonly Unit[]): number {
  const { width } = state.map;
  const onLine = new Set(a.line);
  const occupied = new Set(
    units.filter((u) => u.type !== 'artillery' && onLine.has(u.slot)).map((u) => u.slot),
  );
  const covered = new Set<HexId>();
  for (const u of units) {
    if (u.type !== 'artillery' || u.slot < 0) continue;
    const at = hexFromId(u.slot, width);
    for (const h of a.line) if (distance(hexFromId(h, width), at) <= ARTY_RANGE) covered.add(h);
  }
  let sum = 0;
  for (const h of a.line) {
    if (occupied.has(h)) sum += a.weight.get(h) ?? 0;
    if (covered.has(h)) sum += a.weight.get(h) ?? 0;
  }
  return sum;
}
