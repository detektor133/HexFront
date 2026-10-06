// Набор: очереди и появление отрядов.
// GDD: docs/gdd/05-armies.md — «Набор»
import { MAX_UNITS_PER_HEX, ORG_MAX } from '../balance.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, intDiv, type Fp } from '../math/int.ts';
import { neediestArmy } from '../state/armies.ts';
import { planHexes } from '../state/front.ts';
import type { MatchState, Recruitment, Unit } from '../state/types.ts';
import { addUnitToIndex } from '../state/unit-index.ts';

// Свой проходимый гекс без чужих отрядов и с местом: сначала город, иначе ближайший к нему,
// при равной дистанции — наименьший HexId.
function spawnHex(state: MatchState, owner: number, cityHex: HexId): HexId | null {
  const { width } = state.map;
  const count = new Map<HexId, number>();
  const foreign = new Set<HexId>();
  for (const a of state.units) {
    if (a.owner === owner) count.set(a.hex, (count.get(a.hex) ?? 0) + 1);
    else foreign.add(a.hex);
  }
  const center = hexFromId(cityHex, width);
  let best: HexId | null = null;
  let bestDist = Infinity;
  state.hexes.owner.forEach((o, id) => {
    if (o !== owner || state.map.terrain[id] === TERRAIN.water || foreign.has(id)) return;
    if ((count.get(id) ?? 0) >= MAX_UNITS_PER_HEX) return;
    const d = distance(center, hexFromId(id, width));
    if (d < bestDist) {
      best = id;
      bestDist = d;
    }
  });
  return best;
}

function spawn(state: MatchState, r: Recruitment, hex: HexId): void {
  // Id растут монотонно, поэтому push сохраняет сортировку отрядов по id.
  const unit: Unit = {
    id: state.nextId,
    owner: r.owner,
    type: r.type,
    soldiers: r.soldiers,
    org: ORG_MAX,
    hex,
    order: 'idle',
    supplyLevel: FP as Fp,
    path: [],
    moveTicks: 0,
    moveTotal: 0,
    // Резерв; с «Автопополнением» — самая нуждающаяся армия (CR-001).
    armyId: state.players[r.owner]?.autoReinforce ? neediestArmy(state, r.owner) : null,
    lowSupplyTicks: 0,
    encircled: false,
    target: -1,
    inBattle: false,
    focus: -1,
    fireTarget: -1,
    slot: -1,
  };
  state.units.push(unit);
  addUnitToIndex(state, unit);
  state.nextId += 1;
}

// При закрытой линии автопополнение доливает самый маленький однотипный отряд на линии.
function reinforce(state: MatchState, r: Recruitment): boolean {
  if (!state.players[r.owner]?.autoReinforce) return false;
  const armyId = neediestArmy(state, r.owner);
  const plan = state.plans.find((p) => p.armyId === armyId);
  if (armyId === null || !plan) return false;
  const line = new Set(planHexes(state, plan));
  const units = state.units
    .filter((u) => u.armyId === armyId && u.type === r.type && line.has(u.slot))
    .sort((a, b) => a.soldiers - b.soldiers || a.id - b.id);
  if (units.length < line.size) return false;
  const target = units.find((u) => !u.inBattle);
  if (!target) return false;
  const total = target.soldiers + r.soldiers;
  target.org = intDiv(target.org * target.soldiers + ORG_MAX * r.soldiers, total) as Fp;
  target.soldiers = total as Fp;
  return true;
}

/**
 * Двигает наборы на тик. Потеря города отменяет набор без возврата людей и золота; если всем
 * своим гексам не хватает места, готовый отряд ждёт в очереди.
 */
export function recruitSystem(state: MatchState): void {
  const remaining: Recruitment[] = [];
  for (const r of state.recruits) {
    const city = state.cities.find((c) => c.id === r.cityId);
    const event = { playerId: r.owner, cityId: r.cityId, type: r.type };
    if (city?.owner !== r.owner) {
      state.events.push({ t: 'recruitCancelled', ...event });
      continue;
    }
    if (r.progressTicks < r.totalTicks) r.progressTicks += 1;
    if (r.progressTicks >= r.totalTicks && reinforce(state, r)) {
      state.events.push({ t: 'unitRecruited', ...event });
      continue;
    }
    const hex = r.progressTicks < r.totalTicks ? null : spawnHex(state, r.owner, city.hex);
    if (hex === null) {
      remaining.push(r);
      continue;
    }
    spawn(state, r, hex);
    state.events.push({ t: 'unitRecruited', ...event });
  }
  state.recruits.splice(0, state.recruits.length, ...remaining);
}
