// Снятие направления (07-controls.md, «Меню страны»): фронт и заказ набора убраны, армия остаётся
// со своими отрядами и лимитом, но стоит без дела — «пустая» она исчезает только по приказу игрока.
import { removePlan } from './plan.ts';
import type { Army, MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/**
 * Снимает направление армии: план и заказ набора убраны, отряды остаются в армии, направление
 * переходит в `idle` (по цели армию находит следующий приказ), лимит `wanted` сохраняется.
 */
export function releaseDirection(state: MatchState, army: Army): void {
  removePlan(state, army.id);
  for (const u of allUnits(state)) {
    if (u.armyId === army.id) u.slot = -1;
  }
  const rest = state.recruits.filter((r) => r.armyId !== army.id);
  state.recruits.splice(0, state.recruits.length, ...rest);
  if (army.dir !== undefined) army.dir = { target: army.dir.target, mode: 'idle' };
}
