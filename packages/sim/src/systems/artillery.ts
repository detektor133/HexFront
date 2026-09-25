// Обстрел артиллерией: автоцель или фокус огня, урон солдатам и организованности.
// GDD: docs/gdd/06-combat.md — «Артиллерия».
import {
  ARTY_DMG_PER_SOLDIER_S,
  ARTY_ORG_DMG_PER_SOLDIER_S,
  ARTY_RANGE,
  TICKS_PER_S,
} from '../balance.ts';
import { supplyCombatMult } from './combat.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { fpMul, intDiv, type Fp } from '../math/int.ts';
import type { MatchState, Unit } from '../state/types.ts';

// Самый крупный отряд, при равенстве — с меньшим id (отряды отсортированы по id).
function largest(units: readonly Unit[]): Unit | undefined {
  let best: Unit | undefined;
  for (const u of units) if (!best || u.soldiers > best.soldiers) best = u;
  return best;
}

function bordersOwner(state: MatchState, hex: HexId, owner: number): boolean {
  const { width, height } = state.map;
  return neighbors(hexFromId(hex, width)).some(
    (n) => inBounds(n, width, height) && state.hexes.owner[hexId(n, width)] === owner,
  );
}

/**
 * Цель артиллерии: фокус огня, если он в радиусе; иначе атакующий наш гекс → самый крупный
 * отряд у нашей территории → вражеская артиллерия → самый крупный отряд в радиусе.
 * @returns вражеский отряд в радиусе ARTY_RANGE или undefined
 */
export function fireTargetOf(state: MatchState, art: Unit): Unit | undefined {
  const { width } = state.map;
  const at = hexFromId(art.hex, width);
  const inRange = state.units.filter(
    (u) => u.owner !== art.owner && distance(at, hexFromId(u.hex, width)) <= ARTY_RANGE,
  );
  const focused = inRange.find((u) => u.id === art.focus);
  if (focused) return focused;
  const attacking = inRange.filter(
    (u) => u.order === 'attack' && state.hexes.owner[u.target] === art.owner,
  );
  return (
    largest(attacking) ??
    largest(inRange.filter((u) => bordersOwner(state, u.hex, art.owner))) ??
    largest(inRange.filter((u) => u.type === 'artillery')) ??
    largest(inRange)
  );
}

/**
 * Обстрел за тик: урон солдатам ARTY_DMG_PER_SOLDIER_S × солдаты × supplyMult, урон org
 * ARTY_ORG_DMG_PER_SOLDIER_S × солдаты (в секунду). Все батареи стреляют одновременно.
 */
export function artillerySystem(state: MatchState): void {
  // Флаг боя тика ставят обстрел и combatSystem; сбрасывается здесь, в первой из двух систем.
  for (const u of state.units) {
    u.inBattle = false;
    if (u.type === 'artillery') u.fireTarget = -1;
  }
  const hits = new Map<Unit, { soldiers: number; org: number }>();
  for (const art of state.units) {
    if (art.type !== 'artillery' || art.order === 'retreat') continue;
    const target = fireTargetOf(state, art);
    if (!target) continue;
    art.fireTarget = target.id;
    const dmg = fpMul(
      fpMul(art.soldiers, ARTY_DMG_PER_SOLDIER_S),
      supplyCombatMult(art.supplyLevel),
    );
    const hit = hits.get(target) ?? { soldiers: 0, org: 0 };
    hit.soldiers += intDiv(dmg, TICKS_PER_S);
    hit.org += intDiv(fpMul(art.soldiers, ARTY_ORG_DMG_PER_SOLDIER_S), TICKS_PER_S);
    hits.set(target, hit);
  }
  for (const [u, h] of hits) {
    u.soldiers = Math.max(0, u.soldiers - h.soldiers) as Fp;
    u.org = Math.max(0, u.org - h.org) as Fp;
    u.inBattle = true;
  }
}
