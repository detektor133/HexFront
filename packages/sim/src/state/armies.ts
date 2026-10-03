// Армии — группы отрядов (CR-001): нуждаемость для «Автопополнения».
// GDD: docs/gdd/05-armies.md — «Набор».
import { planHexes } from './front.ts';
import type { MatchState } from './types.ts';

/**
 * Самая нуждающаяся армия игрока: сначала армии с планом — с наименьшим числом солдат на гекс
 * своей линии (CR-002); затем армии без плана — с наименьшим числом солдат; при равенстве —
 * меньший id.
 * @returns id армии или null, если армий нет
 */
export function neediestArmy(state: MatchState, owner: number): number | null {
  let best: number | null = null;
  let bestKey: readonly [number, number] = [Infinity, Infinity];
  for (const army of state.armies) {
    if (army.owner !== owner) continue;
    let soldiers = 0;
    for (const u of state.units) if (u.armyId === army.id) soldiers += u.soldiers;
    const plan = state.plans.find((p) => p.armyId === army.id);
    const hexes = plan ? Math.max(1, planHexes(state, plan).length) : 0;
    // Сравнение «солдат на гекс» без деления: a/x < b/y ⇔ a·y < b·x (x, y > 0).
    const key: readonly [number, number] = plan ? [0, soldiers] : [1, soldiers];
    const better =
      key[0] < bestKey[0] ||
      (key[0] === bestKey[0] &&
        (plan && best !== null && bestKey[0] === 0
          ? soldiers * bestHexes(state, best) < bestKey[1] * hexes
          : key[1] < bestKey[1]));
    if (best === null || better) {
      best = army.id;
      bestKey = key;
    }
  }
  return best;
}

function bestHexes(state: MatchState, armyId: number): number {
  const plan = state.plans.find((p) => p.armyId === armyId);
  return plan ? Math.max(1, planHexes(state, plan).length) : 1;
}
