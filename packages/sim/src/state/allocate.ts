// Расчёт мест отрядов армии на линии плана (CR-002): вес угрозы, равномерность при равной
// угрозе, броня на равнину, артиллерия позади линии. Состояние не меняет.
// GDD: docs/gdd/07-controls.md — «Распределение».
import { atWar } from './relations.ts';
import {
  ARTY_RANGE,
  FRONT_WEIGHT_CAPITAL,
  FRONT_WEIGHT_CITY,
  FRONT_WEIGHT_DEPOT,
  FRONT_WEIGHT_FLANK,
  MAX_UNITS_PER_HEX,
  OFFENSIVE_FACING_WEIGHT,
  OFFENSIVE_STACK,
} from '../balance.ts';
import { attachUnits, lineRuns } from './attach.ts';
import { isDepot } from './depot.ts';
import { planHexes } from './front.ts';
import { facingHexes, lineDistance } from './offensive-steps.ts';
import { type ArmyPlan, type MatchState, type Unit } from './types.ts';
import { allUnits } from './unit-index.ts';
import { TERRAIN } from '../map/types.ts';
import { minCostAssignment } from '../math/assign.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';

/** Дальность упреждающей угрозы, гексов: вес врага падает с расстоянием от полного (1 гекс) до 1/3. */
const THREAT_REACH = 3;

/** Вес угрозы считается в сотнях вражеских солдат (07-controls.md). */
const THREAT_SOLDIERS = 100;

/** Места отрядов армии и покрытие (сумма весов занятых гексов линии и под огнём артиллерии). */
export interface Allocation {
  readonly slots: ReadonlyMap<number, HexId>;
  readonly coverage: number;
  readonly line: readonly HexId[];
  /** Вес гекса линии, fixed-point. */
  readonly weight: ReadonlyMap<HexId, number>;
  /** Места при наименьших переменах: стоящие на линии не двигаются, место ищется только остальным. */
  readonly kept: ReadonlyMap<number, HexId>;
  /** Покрытие `kept`, сравнимое с `coverage` полной перестановки. */
  readonly keptCoverage: number;
}

function around(state: MatchState, hex: HexId): HexId[] {
  const { width, height } = state.map;
  return neighbors(hexFromId(hex, width))
    .filter((n) => inBounds(n, width, height))
    .map((n) => hexId(n, width));
}

/**
 * Вес гекса линии: FP + вражеские солдаты на соседних гексах, в сотнях; город, столица и склад
 * на гексе; фланг — за каждую сторону с вражеской землёй сверх первой. Закрывать в первую очередь
 * то, что дороже и опаснее.
 */
function weights(state: MatchState, owner: number, line: readonly HexId[]): Map<HexId, number> {
  const out = new Map<HexId, number>();
  const capitalId = state.players[owner]?.capitalCityId;
  for (const h of line) {
    const near = around(state, h);
    const here = hexFromId(h, state.map.width);
    // Угроза с упреждением: враг рядом давит в полную силу, дальше — слабее (до THREAT_REACH гексов),
    // поэтому резерв подтягивается к участку, к которому враг идёт, до первого удара.
    let enemy = 0;
    for (const u of state.units) {
      if (!atWar(state, owner, u.owner)) continue;
      const d = distance(here, hexFromId(u.hex, state.map.width));
      if (d <= THREAT_REACH)
        enemy += intDiv(u.soldiers * (THREAT_REACH + 1 - Math.max(1, d)), THREAT_REACH);
    }
    let weight: number = FP + intDiv(enemy, THREAT_SOLDIERS);
    const city = state.cities.find((c) => c.hex === h);
    if (city) weight += city.id === capitalId ? FRONT_WEIGHT_CAPITAL : FRONT_WEIGHT_CITY;
    if (isDepot(state.hexes.building[h] ?? 0)) weight += FRONT_WEIGHT_DEPOT;
    const hostileSides = near.filter((n) => {
      const o = state.hexes.owner[n] ?? -1;
      return o >= 0 && o !== owner && atWar(state, owner, o);
    }).length;
    weight += Math.max(0, hostileSides - 1) * FRONT_WEIGHT_FLANK;
    out.set(h, weight);
  }
  return out;
}

/** Место отряда: отдан вручную и свободен от плана, пока его не передадут в армию заново. */
export const SLOT_DETACHED = -2;

/** Отряд армии, которым сейчас может распоряжаться план. */
export function planControls(u: Unit, armyId: number): boolean {
  if (u.armyId !== armyId || u.order === 'retreat' || u.slot === SLOT_DETACHED) return false;
  return u.order === 'idle' || (u.order === 'move' && u.slot >= 0);
}

// Гексы линии для n отрядов: n ≤ M — самые угрожаемые, при равенстве — равномерно вдоль линии;
// n > M — все гексы и вторые/третьи места на самых угрожаемых. При наступлении (`front` не пуст)
// сначала заполняются гексы наступающего фронта до предела отряда на гекс, и только излишек уходит
// на остальную линию: иначе большая часть войска стояла бы без дела на участках, где не наступают.
function lineSlots(
  line: readonly HexId[],
  w: Map<HexId, number>,
  n: number,
  cap: (h: HexId) => number,
  front: ReadonlySet<HexId> = new Set(),
  held: ReadonlySet<HexId> = new Set(),
): HexId[] {
  const m = line.length;
  if (m === 0 || n === 0) return [];
  const even = new Set<number>();
  for (let k = 0; k < Math.min(n, m); k += 1) even.add(intDiv((2 * k + 1) * m, 2 * Math.min(n, m)));
  // Вес врага скачет каждый тик; гекс, который отряды уже держат, весит на половину и FP больше, иначе
  // «лишнее» место при делении отрядов по гексам перескакивало бы туда-сюда и отряды бегали бы вдоль линии.
  const score = (h: HexId): number => {
    const base = w.get(h) ?? 0;
    return held.has(h) ? base + Math.max(FP, intDiv(base, 2)) : base;
  };
  const order = line
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => cap(h) > 0)
    .sort(
      (a, b) =>
        score(b.h) - score(a.h) || Number(!even.has(a.i)) - Number(!even.has(b.i)) || a.i - b.i,
    );
  const out: HexId[] = [];
  const used = new Map<HexId, number>();
  const fill = (hexes: readonly HexId[], rounds = MAX_UNITS_PER_HEX): void => {
    for (let round = 0; out.length < n && round < rounds; round += 1) {
      for (const h of hexes) {
        if (out.length >= n) break;
        if ((used.get(h) ?? 0) >= cap(h)) continue;
        used.set(h, (used.get(h) ?? 0) + 1);
        out.push(h);
      }
    }
  };
  const ordered = order.map(({ h }) => h);
  // Гексы наступающего фронта заполняются первыми, но не больше OFFENSIVE_STACK отрядов на гекс
  // (больше шагов за раз всё равно не сделать), излишек уходит на остальную линию.
  fill(
    ordered.filter((h) => front.has(h)),
    OFFENSIVE_STACK,
  );
  fill(ordered.filter((h) => !front.has(h)));
  fill(ordered);
  return out;
}

/** Штраф к расстоянию, когда род войск не тот, что нужен на местности (броня — равнина, пехота — прочее). */
const TYPE_PENALTY = 2;

/** Шаг стоимости в назначении: один гекс пути; полшага — выигрыш отряда, уже идущего на это место. */
const STEP_COST = 10;

/** Выигрыш отряда, уже идущего на это место, — полшага. */
const STAY_BONUS = 5;

/** Крупнее этого назначение по венгерскому алгоритму слишком дорого — берём жадный перебор пар. */
const OPTIMAL_ASSIGN_MAX = 120;

// Места — отрядам с наименьшим общим переходом: оптимальное назначение по сумме расстояний (с
// поправкой на род войск), а не «место по важности — ближайшему отряду» или жадный перебор пар:
// ни слабому месту не достаётся дальний отряд, ни ближний отряд не идёт туда, где стоит дальний.
// Отряд, уже идущий на это место, немного предпочитает его — пересмотр не гоняет отряды туда-сюда.
function assignLine(
  state: MatchState,
  slots: HexId[],
  units: Unit[],
  w: Map<HexId, number>,
): Map<number, HexId> {
  const { width } = state.map;
  const out = new Map<number, HexId>();
  if (slots.length === 0 || units.length === 0) return out;
  if (units.length <= OPTIMAL_ASSIGN_MAX && slots.length <= OPTIMAL_ASSIGN_MAX) {
    const costOf = (u: Unit, h: HexId): number => {
      const wanted = state.map.terrain[h] === TERRAIN.plains ? 'armor' : 'infantry';
      const miles =
        distance(hexFromId(u.hex, width), hexFromId(h, width)) +
        (u.type === wanted ? 0 : TYPE_PENALTY);
      return miles * STEP_COST - (u.slot === h ? STAY_BONUS : 0);
    };
    if (units.length <= slots.length) {
      const pick = minCostAssignment(units.map((u) => slots.map((h) => costOf(u, h))));
      units.forEach((u, i) => out.set(u.id, slots[pick[i] as number] as HexId));
    } else {
      const pick = minCostAssignment(slots.map((h) => units.map((u) => costOf(u, h))));
      slots.forEach((h, i) => out.set((units[pick[i] as number] as Unit).id, h));
    }
    return out;
  }
  const open = [...slots];
  const free = units;
  const pairs: { readonly u: Unit; readonly s: number; readonly cost: number }[] = [];
  open.forEach((h, s) => {
    const plains = state.map.terrain[h] === TERRAIN.plains;
    const wanted = plains ? 'armor' : 'infantry';
    const at = hexFromId(h, width);
    for (const u of free) {
      const cost = distance(hexFromId(u.hex, width), at) + (u.type === wanted ? 0 : TYPE_PENALTY);
      pairs.push({ u, s, cost });
    }
  });
  pairs.sort(
    (x, y) =>
      x.cost - y.cost ||
      (w.get(open[y.s] as HexId) ?? 0) - (w.get(open[x.s] as HexId) ?? 0) ||
      x.u.id - y.u.id ||
      x.s - y.s,
  );
  const usedSlot = new Set<number>();
  for (const p of pairs) {
    if (out.has(p.u.id) || usedSlot.has(p.s)) continue;
    out.set(p.u.id, open[p.s] as HexId);
    usedSlot.add(p.s);
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
  // Идёт наступление — гексы с гранями, смотрящими на линию, весят больше: армия стягивает силы.
  if (plan.kind === 'front' && plan.offensive?.active) {
    const dist = lineDistance(state, plan.offensive.hexes);
    for (const h of facingHexes(state, plan.edges, dist)) {
      w.set(h, (w.get(h) ?? 0) * OFFENSIVE_FACING_WEIGHT);
    }
  }
  const attackFront = new Set<HexId>();
  if (plan.kind === 'front' && plan.offensive?.active) {
    const dist = lineDistance(state, plan.offensive.hexes);
    for (const h of facingHexes(state, plan.edges, dist)) attackFront.add(h);
  }
  const units = allUnits(state).filter((u) => planControls(u, plan.armyId));
  const lineUnits = units.filter((u) => u.type !== 'artillery');
  const arty = units.filter((u) => u.type === 'artillery');
  // Место в гексе занимают и чужие для плана свои отряды (другие армии, резерв).
  const cap = (h: HexId): number =>
    MAX_UNITS_PER_HEX -
    allUnits(state).filter((u) => u.owner === owner && u.hex === h && !units.includes(u)).length;
  // Линий у армии может быть несколько: отряд закреплён за своей и расставляется внутри неё.
  const runs = lineRuns(state, line);
  const groups = attachUnits(state, runs, w, lineUnits);
  const slots = new Map<number, HexId>();
  // Расстановка с наименьшими переменами: уже стоящие на линии остаются, места ищутся лишь новым,
  // потерявшим место и тем, чья линия сдвинулась. Её покрытие сравнивается с полной перестановкой.
  const kept = new Map<number, HexId>();
  runs.forEach((run, r) => {
    const mine = groups[r] ?? [];
    const runSet = new Set(run);
    const held = new Set(
      mine.flatMap((u) => [u.slot, u.hex].filter((h) => h >= 0 && runSet.has(h)).slice(0, 1)),
    );
    const target = lineSlots(run, w, mine.length, cap, attackFront, held);
    for (const [id, h] of assignLine(state, target, mine, w)) {
      slots.set(id, h);
    }
    const stay = mine.filter((u) => runSet.has(u.slot));
    const rest = [...target];
    for (const u of stay) {
      kept.set(u.id, u.slot);
      const i = rest.indexOf(u.slot);
      if (i >= 0) rest.splice(i, 1);
    }
    const open = mine.filter((u) => !runSet.has(u.slot));
    const extra = lineSlots(run, w, stay.length + open.length, cap, attackFront, held);
    for (const h of extra) {
      if (rest.length >= open.length) break;
      rest.push(h);
    }
    // Набор мест уже устойчив; кто на каком — снова по наименьшему общему переходу, чтобы дальний
    // не шёл на место рядом с ближним, который держит менее нужное.
    const pool = [...stay.map((u) => u.slot), ...rest];
    for (const [id, h] of assignLine(state, pool, mine, w)) kept.set(id, h);
  });
  const art = assignArtillery(state, owner, arty, line, w);
  for (const [id, h] of art.slots) {
    slots.set(id, h);
    const was = arty.find((a) => a.id === id);
    kept.set(id, was !== undefined && was.slot >= 0 && !onLineSet(line, was.slot) ? was.slot : h);
  }
  const coverageOf = (placed: ReadonlyMap<number, HexId>): number => {
    const occupied = new Set(
      [...placed].filter(([id]) => !arty.some((a) => a.id === id)).map(([, h]) => h),
    );
    return (
      line.filter((h) => occupied.has(h)).reduce((s, h) => s + (w.get(h) ?? 0), 0) + art.covered
    );
  };
  return {
    slots,
    coverage: coverageOf(slots),
    line,
    weight: w,
    kept,
    keptCoverage: coverageOf(kept),
  };
}

const onLineSet = (line: readonly HexId[], h: number): boolean => line.includes(h);

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
