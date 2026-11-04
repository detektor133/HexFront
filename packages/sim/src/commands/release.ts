// Снятие направления (07-controls.md, «Меню страны»): фронт и заказ убираются, отряды уходят в
// резерв, армия расформировывается.
import { removePlan } from './plan.ts';
import type { Army, MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/** Снимает направление армии: план и заказ набора убраны, отряды — в резерв, армии больше нет. */
export function releaseDirection(state: MatchState, army: Army): void {
  removePlan(state, army.id);
  for (const u of allUnits(state)) {
    if (u.armyId === army.id) {
      u.armyId = null;
      u.slot = -1;
    }
  }
  const rest = state.recruits.filter((r) => r.armyId !== army.id);
  state.recruits.splice(0, state.recruits.length, ...rest);
  const armies = state.armies.filter((a) => a.id !== army.id);
  state.armies.splice(0, state.armies.length, ...armies);
}
