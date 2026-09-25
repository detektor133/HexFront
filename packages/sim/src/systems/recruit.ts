// Набор: очереди и появление армий.
// GDD: docs/gdd/05-armies.md — «Набор»
import { MAX_ARMIES_PER_HEX, ORG_MAX } from '../balance.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, type Fp } from '../math/int.ts';
import type { MatchState, Recruitment } from '../state/types.ts';

// Свой проходимый гекс без чужих армий и с местом: сначала город, иначе ближайший к нему,
// при равной дистанции — наименьший HexId.
function spawnHex(state: MatchState, owner: number, cityHex: HexId): HexId | null {
  const { width } = state.map;
  const count = new Map<HexId, number>();
  const foreign = new Set<HexId>();
  for (const a of state.armies) {
    if (a.owner === owner) count.set(a.hex, (count.get(a.hex) ?? 0) + 1);
    else foreign.add(a.hex);
  }
  const center = hexFromId(cityHex, width);
  let best: HexId | null = null;
  let bestDist = Infinity;
  state.hexes.owner.forEach((o, id) => {
    if (o !== owner || state.map.terrain[id] === TERRAIN.water || foreign.has(id)) return;
    if ((count.get(id) ?? 0) >= MAX_ARMIES_PER_HEX) return;
    const d = distance(center, hexFromId(id, width));
    if (d < bestDist) {
      best = id;
      bestDist = d;
    }
  });
  return best;
}

function spawn(state: MatchState, r: Recruitment, hex: HexId): void {
  // Id растут монотонно, поэтому push сохраняет сортировку армий по id.
  state.armies.push({
    id: state.nextId,
    owner: r.owner,
    type: r.type,
    soldiers: r.soldiers,
    org: ORG_MAX,
    hex,
    order: 'idle',
    supplyLevel: FP as Fp,
  });
  state.nextId += 1;
}

/**
 * Двигает наборы на тик. Потеря города отменяет набор без возврата людей и золота; если всем
 * своим гексам не хватает места, готовая армия ждёт в очереди.
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
    const hex = r.progressTicks < r.totalTicks ? null : spawnHex(state, r.owner, city.hex);
    if (hex === null) {
      remaining.push(r);
      continue;
    }
    spawn(state, r, hex);
    state.events.push({ t: 'armyRecruited', ...event });
  }
  state.recruits.splice(0, state.recruits.length, ...remaining);
}
