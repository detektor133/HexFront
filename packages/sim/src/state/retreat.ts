// Отступление и капитуляция отряда, чья организованность упала до нуля.
// GDD: docs/gdd/06-combat.md — «Отступление».
import { MAX_UNITS_PER_HEX, RETREAT_MOVE_MULT, RETREAT_SOLDIER_LOSS } from '../balance.ts';
import { hexSupplyEff } from './supply.ts';
import type { MatchState, Unit } from './types.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { fpMul, intDiv, FP, type Fp } from '../math/int.ts';
import { stepTicks } from '../queries/unit-path.ts';

interface Candidate {
  readonly hex: HexId;
  readonly nearAttacker: boolean;
  readonly supply: number;
}

// Соседний свой проходимый гекс без чужих отрядов, где меньше 3 своих отрядов.
function candidates(state: MatchState, unit: Unit, attackerHexes: readonly HexId[]): Candidate[] {
  const { width, height } = state.map;
  const result: Candidate[] = [];
  for (const n of neighbors(hexFromId(unit.hex, width))) {
    if (!inBounds(n, width, height)) continue;
    const id = hexId(n, width);
    if (state.hexes.owner[id] !== unit.owner || state.map.terrain[id] === TERRAIN.water) continue;
    let own = 0;
    let foreign = false;
    for (const u of state.units) {
      if (u.hex !== id) continue;
      if (u.owner === unit.owner) own += 1;
      else foreign = true;
    }
    if (foreign || own >= MAX_UNITS_PER_HEX) continue;
    const nearAttacker = attackerHexes.some((a) => distance(hexFromId(a, width), n) <= 1);
    result.push({ hex: id, nearAttacker, supply: hexSupplyEff(state, unit.owner, id) });
  }
  // Приоритет: не рядом с атакующими → выше снабжение → меньший HexId.
  return result.sort(
    (a, b) =>
      Number(a.nearAttacker) - Number(b.nearAttacker) || b.supply - a.supply || a.hex - b.hex,
  );
}

/**
 * Отступление сломленного отряда: −RETREAT_SOLDIER_LOSS солдат, сразу в гекс отступления,
 * состояние «отступает» на время хода × RETREAT_MOVE_MULT. Гекса нет — капитуляция.
 * @returns false, если отряд капитулировал и должен быть удалён
 */
export function retreatOrCapitulate(
  state: MatchState,
  unit: Unit,
  attackerHexes: readonly HexId[],
): boolean {
  const target = candidates(state, unit, attackerHexes)[0];
  if (!target) {
    state.events.push({ t: 'unitCapitulated', playerId: unit.owner, unitId: unit.id });
    return false;
  }
  const ticks = stepTicks(state, unit, unit.hex, target.hex) ?? 1;
  unit.soldiers = (unit.soldiers - fpMul(unit.soldiers, RETREAT_SOLDIER_LOSS)) as Fp;
  unit.hex = target.hex;
  unit.order = 'retreat';
  unit.target = -1;
  unit.path = [];
  unit.moveTicks = 0;
  unit.moveTotal = Math.max(1, intDiv(ticks * RETREAT_MOVE_MULT, FP));
  state.events.push({ t: 'unitRetreated', playerId: unit.owner, unitId: unit.id });
  return true;
}
