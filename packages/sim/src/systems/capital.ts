// Перенос столицы, «смута», выбывание, рампа выработки захваченных городов.
// GDD: docs/gdd/03-cities-buildings.md — «Столица»; 08-match.md — «Выбывание».
import { CAPITAL_MOVE_CHAOS_S, NO_CITY_GRACE_S, TICKS_PER_S } from '../balance.ts';
import { FP, intDiv } from '../math/int.ts';
import { recomputeNetworks } from '../state/network.ts';
import { NEUTRAL, type City, type MatchState, type Player } from '../state/types.ts';

const CHAOS_TICKS = intDiv(CAPITAL_MOVE_CHAOS_S * TICKS_PER_S, FP);
const GRACE_TICKS = intDiv(NO_CITY_GRACE_S * TICKS_PER_S, FP);

// Новая столица: город крупнейшей сети (по числу узлов), в ней — самый населённый, затем меньший id.
function pickCapital(state: MatchState, cities: readonly City[]): City | undefined {
  const size = new Map<number, number>();
  for (const id of state.hexes.network) if (id >= 0) size.set(id, (size.get(id) ?? 0) + 1);
  const key = (c: City): [number, number] => [
    size.get(state.hexes.network[c.hex] ?? -1) ?? 0,
    state.hexes.pop[c.hex] ?? 0,
  ];
  let best: City | undefined;
  for (const c of cities) {
    if (!best) {
      best = c;
      continue;
    }
    const [net, pop] = key(c);
    const [bestNet, bestPop] = key(best);
    if (net > bestNet || (net === bestNet && pop > bestPop)) best = c;
  }
  return best;
}

// Выбывший: территория нейтральна (без гарнизонов), отряды, армии, стройки и наборы распущены.
function eliminate(state: MatchState, p: Player): void {
  p.status = 'eliminated';
  p.eliminatedTick = state.tick;
  p.capitalCityId = -1;
  const { owner, network } = state.hexes;
  owner.forEach((o, hex) => {
    if (o !== p.id) return;
    owner[hex] = NEUTRAL;
    network[hex] = -1;
  });
  const keep = <T extends { owner: number }>(list: T[]): void => {
    const rest = list.filter((x) => x.owner !== p.id);
    list.splice(0, list.length, ...rest);
  };
  keep(state.units);
  keep(state.armies);
  keep(state.constructions);
  keep(state.recruits);
  state.networks = state.networks.filter((n) => n.owner !== p.id);
  state.events.push({ t: 'playerEliminated', playerId: p.id });
}

function updatePlayer(state: MatchState, p: Player): void {
  if (p.chaosTicks > 0) p.chaosTicks -= 1;
  const cities = state.cities.filter((c) => c.owner === p.id);
  if (cities.length === 0) {
    p.capitalCityId = -1;
    p.noCityTicks += 1;
    const hasUnits = state.units.some((u) => u.owner === p.id);
    if (!hasUnits || p.noCityTicks >= GRACE_TICKS) eliminate(state, p);
    return;
  }
  p.noCityTicks = 0;
  if (cities.some((c) => c.id === p.capitalCityId)) return;
  // Столица потеряна при других городах — «смута»; первый город после безгородья — без неё.
  const lost = p.capitalCityId >= 0;
  recomputeNetworks(state, p.id);
  const capital = pickCapital(state, cities);
  if (!capital) return;
  p.capitalCityId = capital.id;
  recomputeNetworks(state, p.id);
  if (lost) p.chaosTicks = CHAOS_TICKS;
  state.events.push({ t: 'capitalMoved', playerId: p.id, cityId: capital.id });
}

/** Рампа выработки городов, перенос столиц и выбывание — по игрокам в порядке id. */
export function capitalSystem(state: MatchState): void {
  for (const c of state.cities) if (c.captureTicks > 0) c.captureTicks -= 1;
  for (const p of state.players) if (p.status === 'alive') updatePlayer(state, p);
}
