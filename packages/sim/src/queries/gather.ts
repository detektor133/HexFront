// Область сбора отрядов (CR-010, gdd/05-armies.md): детерминированный выбор гекса и соседей.
import { MAX_UNITS_PER_HEX } from '../balance.ts';
import { findPath, isHostileHex, stepTicks } from './unit-path.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import type { MatchState, Unit } from '../state/types.ts';
import { unitIndex } from '../state/unit-index.ts';

/** Гекс сбора для каждого отряда: unitId → hexId. */
export type GatherTargets = ReadonlyMap<number, HexId>;

// Время пути отряда до гекса в тиках; null — недостижим.
function travelTicks(state: MatchState, unit: Unit, to: HexId): number | null {
  const path = findPath(state, unit.hex, to, unit.type, unit.owner);
  if (path === null) return null;
  let from = unit.hex;
  let total = 0;
  for (const hex of path) {
    const ticks = stepTicks(state, unit, from, hex);
    if (ticks === null) return null;
    total += ticks;
    from = hex;
  }
  return total;
}

// Отряды сливаются после прибытия только внутри армии и типа; резервные остаются каждый сам по себе.
function groupKey(unit: Unit): string {
  return unit.armyId === null ? `r${unit.id}` : `${unit.type}:${unit.armyId}`;
}

function freeSlots(state: MatchState, owner: number, hex: HexId, selected: ReadonlySet<number>) {
  let busy = 0;
  for (const u of unitIndex(state).unitsByHex[hex] ?? [])
    if (u.owner === owner && !selected.has(u.id)) busy += 1;
  return MAX_UNITS_PER_HEX - busy;
}

function ownLandHexes(state: MatchState, owner: number): HexId[] {
  const out: HexId[] = [];
  for (let hex = 0; hex < state.hexes.owner.length; hex += 1) {
    if (state.hexes.owner[hex] === owner && !isHostileHex(state, owner, hex)) out.push(hex);
  }
  return out;
}

/**
 * Выбирает базовый гекс: минимальное максимальное время пути, затем минимальная сумма, затем
 * меньший hexId. Если после слияний групп больше мест, область растёт соседними своими
 * гексами: сначала ближайшие к базе, при равенстве — с меньшим hexId.
 * @returns гекс каждого отряда или null, если подходящей области нет
 */
export function planGather(
  state: MatchState,
  owner: number,
  units: readonly Unit[],
): GatherTargets | null {
  const selected = new Set(units.map((u) => u.id));
  const { width, height } = state.map;
  const reach = (hex: HexId): { max: number; sum: number } | null => {
    let max = 0;
    let sum = 0;
    for (const unit of units) {
      const ticks = unit.hex === hex ? 0 : travelTicks(state, unit, hex);
      if (ticks === null) return null;
      max = Math.max(max, ticks);
      sum += ticks;
    }
    return { max, sum };
  };
  const land = ownLandHexes(state, owner);
  const first = units[0];
  if (!first) return null;
  // Цель не дальше, чем самый далёкий отряд от первого: середина лежит между отрядами.
  const span = Math.max(
    ...units.map((u) => distance(hexFromId(u.hex, width), hexFromId(first.hex, width))),
  );
  let best: { hex: HexId; max: number; sum: number } | null = null;
  for (const hex of land) {
    if (freeSlots(state, owner, hex, selected) < 1) continue;
    if (distance(hexFromId(hex, width), hexFromId(first.hex, width)) > span) continue;
    const cost = reach(hex);
    if (!cost) continue;
    if (
      !best ||
      cost.max < best.max ||
      (cost.max === best.max && (cost.sum < best.sum || (cost.sum === best.sum && hex < best.hex)))
    )
      best = { hex, ...cost };
  }
  if (!best) return null;

  const groups = new Map<string, Unit[]>();
  for (const unit of [...units].sort((a, b) => a.id - b.id)) {
    const group = groups.get(groupKey(unit)) ?? [];
    group.push(unit);
    groups.set(groupKey(unit), group);
  }
  const area: HexId[] = [best.hex];
  let capacity = freeSlots(state, owner, best.hex, selected);
  const base = hexFromId(best.hex, width);
  while (capacity < groups.size) {
    let next: HexId | null = null;
    for (const hex of area) {
      for (const n of neighbors(hexFromId(hex, width))) {
        if (!inBounds(n, width, height)) continue;
        const id = hexId(n, width);
        if (area.includes(id) || !land.includes(id) || freeSlots(state, owner, id, selected) < 1)
          continue;
        if (reach(id) === null) continue;
        const d = distance(n, base);
        const bestD = next === null ? Infinity : distance(hexFromId(next, width), base);
        if (d < bestD || (d === bestD && next !== null && id < next)) next = id;
      }
    }
    if (next === null) return null;
    area.push(next);
    capacity += freeSlots(state, owner, next, selected);
  }
  const targets = new Map<number, HexId>();
  let index = 0;
  let used = 0;
  for (const group of groups.values()) {
    const hex = area[index] as HexId;
    for (const unit of group) targets.set(unit.id, hex);
    used += 1;
    if (used >= freeSlots(state, owner, hex, selected)) {
      index += 1;
      used = 0;
    }
  }
  return targets;
}
