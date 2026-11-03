// Завершение приказа сбора (CR-010): отряд на месте сливается с совместимыми; остановленный
// по пути приказ сбора снимается.
import { MAX_UNITS_PER_HEX } from '../balance.ts';
import { mergeUnits } from '../commands/unit.ts';
import { findPath, ownUnitsAt } from '../queries/unit-path.ts';
import type { MatchState, Unit } from '../state/types.ts';

// Следующий гекс пути заполнен: ждать бесконечно нельзя — путь строится заново в обход заполненных.
function reroute(state: MatchState, unit: Unit): void {
  const next = unit.path[0];
  if (unit.order !== 'move' || unit.moveTicks < unit.moveTotal || next === undefined) return;
  if (ownUnitsAt(state, unit.owner, next) < MAX_UNITS_PER_HEX) return;
  const path = findPath(state, unit.hex, unit.gather, unit.type, unit.owner);
  if (path === null) {
    unit.path = [];
    unit.order = 'idle';
  } else {
    unit.path = path;
    unit.moveTicks = 0;
    unit.moveTotal = 0;
  }
}

/** После движения: прибывшие отряды сливаются по типу и армии, брошенный сбор снимается. */
export function gatherSystem(state: MatchState): void {
  const arrived = new Map<string, Unit[]>();
  for (const unit of state.units) {
    if (unit.gather < 0) continue;
    reroute(state, unit);
    if (unit.hex === unit.gather && unit.order !== 'move') {
      unit.gather = -1;
      if (unit.armyId === null) continue;
      const key = `${unit.hex}:${unit.type}:${unit.armyId}`;
      arrived.set(key, [...(arrived.get(key) ?? []), unit]);
    } else if (unit.order !== 'move') {
      unit.gather = -1;
    }
  }
  for (const units of arrived.values()) if (units.length > 1) mergeUnits(state, units);
}
