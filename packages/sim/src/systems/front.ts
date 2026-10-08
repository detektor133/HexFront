// Распределение отрядов армий по планам (CR-002): раз в FRONT_ALLOC_TICKS для каждой армии,
// размазано по армиям; перестановка — только при выигрыше покрытия больше порога. Если отрядов
// меньше гексов линии, армия сама делится (CR-005).
// GDD: docs/gdd/07-controls.md — «Планы армий», «Распределение».
import {
  FRONT_ALLOC_TICKS,
  FRONT_REALLOC_GAIN_MIN,
  FRONT_SPLIT_MIN,
  MAX_UNITS_PER_HEX,
} from '../balance.ts';
import { unitLimit } from '../commands/recruit.ts';
import { mergeUnits, splitUnit } from '../commands/unit.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';
import { findPath, ownUnitsAt } from '../queries/unit-path.ts';
import { allocate, currentCoverage, planControls } from '../state/allocate.ts';
import { planHexes } from '../state/front.ts';
import type { MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

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
  // К месту — только по своей земле: иначе отряд берёт чужие гексы по дороге (04/T14b).
  const path = findPath(state, u.hex, slot, u.type, u.owner, true);
  if (!path || path.length === 0) {
    u.slot = -1;
    return;
  }
  u.path = path;
  u.moveTicks = 0;
  u.moveTotal = 0;
  u.order = 'move';
}

/**
 * Автоделение (05-armies.md, CR-005): пока пехоты и брони армии меньше, чем гексов линии,
 * самый большой отряд (при равенстве — меньший id) делится пополам, если обе половины не меньше
 * FRONT_SPLIT_MIN, в его гексе есть место и не превышен лимит отрядов.
 */
function coverLine(state: MatchState, armyId: number, owner: number): void {
  const plan = state.plans.find((p) => p.armyId === armyId);
  if (!plan) return;
  const need = planHexes(state, plan).length;
  for (;;) {
    const units = allUnits(state).filter((u) => planControls(u, armyId) && u.type !== 'artillery');
    const used =
      allUnits(state).filter((u) => u.owner === owner).length +
      state.recruits.filter((r) => r.owner === owner).length;
    if (units.length >= need || used >= unitLimit(state, owner)) return;
    let best: Unit | null = null;
    for (const u of units) {
      if (u.soldiers < 2 * FRONT_SPLIT_MIN || ownUnitsAt(state, owner, u.hex) >= MAX_UNITS_PER_HEX)
        continue;
      if (!best || u.soldiers > best.soldiers) best = u;
    }
    if (!best) return;
    splitUnit(state, best, (intDiv(intDiv(best.soldiers, FP), 2) * FP) as Fp);
  }
}

const bySize = (a: Unit, b: Unit): number => a.soldiers - b.soldiers || a.id - b.id;

// Одно слияние за распределение: пара должна быть однотипной, в одном гексе и не в бою.
function autoMerge(state: MatchState, armyId: number): void {
  const plan = state.plans.find((p) => p.armyId === armyId);
  const need = plan ? planHexes(state, plan).length : 0;
  const armyUnits = allUnits(state).filter((u) => u.armyId === armyId && u.type !== 'artillery');
  const eligible = armyUnits.filter(
    (u) => !u.inBattle && (plan !== undefined || u.order === 'idle'),
  );
  for (const type of ['infantry', 'armor'] as const) {
    const sameType = armyUnits.filter((u) => u.type === type);
    if (plan && sameType.length <= need) continue;
    const candidates = eligible.filter((u) => u.type === type).sort(bySize);
    for (const first of candidates) {
      const second = candidates.find((u) => u.id !== first.id && u.hex === first.hex);
      if (!second) continue;
      mergeUnits(state, [first, second]);
      return;
    }
  }
}

function runPlan(state: MatchState, armyId: number): void {
  const plan = state.plans.find((p) => p.armyId === armyId);
  if (!plan) return;
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  if (owner === undefined) return;
  autoMerge(state, armyId);
  coverLine(state, armyId, owner);
  const next = allocate(state, plan, owner);
  const units = allUnits(state).filter((u) => planControls(u, plan.armyId));
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
  for (const army of state.armies) {
    if (state.plans.some((p) => p.armyId === army.id)) continue;
    if ((state.tick + army.id) % FRONT_ALLOC_TICKS === 0) autoMerge(state, army.id);
  }
}
