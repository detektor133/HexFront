// Армии — группы отрядов (CR-001): нуждаемость для «Автопополнения».
// GDD: docs/gdd/05-armies.md — «Набор».
import type { MatchState } from './types.ts';

/**
 * Самая нуждающаяся армия игрока: до появления фронтов (этап 04) — с наименьшим числом солдат,
 * при равенстве — с меньшим id.
 * @returns id армии или null, если армий нет
 */
export function neediestArmy(state: MatchState, owner: number): number | null {
  let best: number | null = null;
  let bestSoldiers = Infinity;
  for (const army of state.armies) {
    if (army.owner !== owner) continue;
    let soldiers = 0;
    for (const u of state.units) if (u.armyId === army.id) soldiers += u.soldiers;
    // Армии отсортированы по id, поэтому строгое «<» оставляет меньший id при равенстве.
    if (soldiers < bestSoldiers) {
      best = army.id;
      bestSoldiers = soldiers;
    }
  }
  return best;
}
