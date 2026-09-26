// Распределение отрядов армий по планам (CR-002): раз в FRONT_ALLOC_TICKS для каждой армии,
// размазано по армиям; перестановка — только при выигрыше покрытия больше порога.
// GDD: docs/gdd/07-controls.md — «Планы армий», «Распределение».
import { FRONT_ALLOC_TICKS, FRONT_REALLOC_GAIN_MIN } from '../balance.ts';
import { fpMul, type Fp } from '../math/int.ts';
import { findPath } from '../queries/unit-path.ts';
import { allocate, currentCoverage, planControls } from '../state/allocate.ts';
import { followBorder } from '../state/front.ts';
import type { MatchState, Unit } from '../state/types.ts';

// Отряд идёт на своё место или встаёт на нём в оборону.
function goTo(state: MatchState, u: Unit, slot: number): void {
  u.slot = slot;
  if (u.hex === slot) {
    if (u.order === 'move') {
      u.path = [];
      u.moveTicks = 0;
      u.moveTotal = 0;
    }
    u.order = 'idle';
    return;
  }
  if (u.order === 'move' && u.path.at(-1) === slot) return;
  const path = findPath(state, u.hex, slot, u.type, u.owner);
  if (!path || path.length === 0) {
    u.slot = -1;
    return;
  }
  u.path = path;
  u.moveTicks = 0;
  u.moveTotal = 0;
  u.order = 'move';
}

function runPlan(state: MatchState, armyId: number): void {
  followBorder(state, armyId);
  const plan = state.plans.find((p) => p.armyId === armyId);
  if (!plan) return;
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  if (owner === undefined) return;
  const next = allocate(state, plan, owner);
  const units = state.units.filter((u) => planControls(u, plan.armyId));
  const lineSet = new Set(next.line);
  const settled = units.every(
    (u) => u.slot >= 0 && (u.type === 'artillery' || lineSet.has(u.slot)),
  );
  const old = currentCoverage(state, next, units);
  // Против «дрожания»: при малом выигрыше покрытия места не меняются.
  const keep = settled && next.coverage <= old + fpMul(old as Fp, FRONT_REALLOC_GAIN_MIN);
  for (const u of units) {
    const slot = keep ? u.slot : next.slots.get(u.id);
    if (slot === undefined) u.slot = -1;
    else goTo(state, u, slot);
  }
}

/** Раз в FRONT_ALLOC_TICKS раздаёт места отрядам армии с планом; армии — в разные тики. */
export function frontSystem(state: MatchState): void {
  for (const plan of state.plans) {
    if ((state.tick + plan.armyId) % FRONT_ALLOC_TICKS === 0) runPlan(state, plan.armyId);
  }
}
