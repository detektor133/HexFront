// Потери от истощения: снабжение ниже порога дольше льготы.
// GDD: docs/gdd/04-roads-supply.md — «Последствия снабжения».
import {
  ATTRITION_GRACE_S,
  ATTRITION_MAX_PER_S,
  ATTRITION_THRESHOLD,
  TICKS_PER_S,
} from '../balance.ts';
import { FP, fpDiv, fpMul, intDiv, type Fp } from '../math/int.ts';
import type { MatchState, Unit } from '../state/types.ts';

const GRACE_TICKS = intDiv(ATTRITION_GRACE_S * TICKS_PER_S, FP);

/** Отряд теряет солдат от истощения: снабжение ниже порога дольше льготы (04-roads-supply.md). */
export function isStarving(u: Unit): boolean {
  return u.lowSupplyTicks > GRACE_TICKS;
}

/**
 * Доля солдат, теряемая за секунду: ATTRITION_MAX_PER_S × (1 − s / ATTRITION_THRESHOLD).
 * @returns fixed-point доля в секунду; 0 при s ≥ порога
 */
export function attritionPerSecond(supplyLevel: Fp): Fp {
  if (supplyLevel >= ATTRITION_THRESHOLD) return 0 as Fp;
  return fpMul(ATTRITION_MAX_PER_S, (FP - fpDiv(supplyLevel, ATTRITION_THRESHOLD)) as Fp);
}

/** Снимает потери истощения за тик; отряд без солдат уничтожается. */
export function attritionSystem(state: MatchState): void {
  const survivors: Unit[] = [];
  for (const u of state.units) {
    if (isStarving(u)) {
      const lost = intDiv(fpMul(u.soldiers, attritionPerSecond(u.supplyLevel)), TICKS_PER_S);
      u.soldiers = (u.soldiers - lost) as Fp;
    }
    if (u.soldiers > 0) survivors.push(u);
    else state.events.push({ t: 'unitDestroyed', playerId: u.owner, unitId: u.id });
  }
  if (survivors.length !== state.units.length) {
    state.units.splice(0, state.units.length, ...survivors);
  }
}
