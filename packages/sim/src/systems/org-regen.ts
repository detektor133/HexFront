// Восстановление организованности отрядов и ополчения городов вне боя.
// GDD: docs/gdd/06-combat.md — «Отступление» (регенерация); 03-cities-buildings.md — «Захват города».
import {
  ATTRITION_THRESHOLD,
  MILITIA_PER_LEVEL,
  MILITIA_REGEN_PER_S,
  ORG_MAX,
  ORG_REGEN_PER_S,
  TICKS_PER_S,
} from '../balance.ts';
import { intDiv, type Fp } from '../math/int.ts';
import { NEUTRAL, type MatchState } from '../state/types.ts';

const ORG_PER_TICK = intDiv(ORG_REGEN_PER_S, TICKS_PER_S);
const MILITIA_PER_TICK = intDiv(MILITIA_REGEN_PER_S, TICKS_PER_S);

/**
 * +ORG_REGEN_PER_S org/с отрядам вне боя и отступления при supplyLevel ≥ 50 % и без банкротства;
 * ополчение городов игроков вне боя: +MILITIA_REGEN_PER_S солдат/с до 100 × уровень и
 * +ORG_REGEN_PER_S org/с. Гарнизон нейтральных городов не восстанавливается.
 */
export function orgRegenSystem(state: MatchState): void {
  for (const u of state.units) {
    if (u.inBattle || u.order === 'retreat' || u.supplyLevel < ATTRITION_THRESHOLD) continue;
    if (state.players[u.owner]?.bankrupt) continue;
    u.org = Math.min(ORG_MAX, u.org + ORG_PER_TICK) as Fp;
  }
  for (const c of state.cities) {
    if (c.owner === NEUTRAL || c.inBattle) continue;
    c.defenders = Math.min(MILITIA_PER_LEVEL * c.level, c.defenders + MILITIA_PER_TICK) as Fp;
    c.defenseOrg = Math.min(ORG_MAX, c.defenseOrg + ORG_PER_TICK) as Fp;
  }
}
