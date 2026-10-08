import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { createPlayerViewContext, type PlayerViewContext } from '../queries/player-view.ts';
import type { Army, ArmyPlan, City, MatchState, Unit } from '../state/types.ts';

export interface BotTickContext {
  readonly playerView: PlayerViewContext;
  readonly incomeBases: PlayerViewContext['incomeBases'];
  readonly ownedHexes: readonly (readonly HexId[])[];
  readonly borderHexes: readonly (readonly HexId[])[];
  readonly unitsByHex: readonly (readonly Unit[])[];
  readonly unitsByPlayer: readonly (readonly Unit[])[];
  readonly armiesByPlayer: readonly (readonly Army[])[];
  readonly citiesByPlayer: readonly (readonly City[])[];
  readonly plansByPlayer: readonly (readonly ArmyPlan[])[];
  readonly networks: MatchState['networks'];
}

function playerLists<T>(players: number): T[][] {
  return Array.from({ length: players }, () => [] as T[]);
}

function mapOwnedHexes(state: MatchState): { owned: HexId[][]; border: HexId[][] } {
  const owned = playerLists<HexId>(state.players.length);
  const border = playerLists<HexId>(state.players.length);
  state.hexes.owner.forEach((owner, hex) => {
    if (owner < 0 || owner >= owned.length) return;
    owned[owner]?.push(hex);
    const adjacent = neighbors(hexFromId(hex, state.map.width)).some((neighborHex) => {
      if (!inBounds(neighborHex, state.map.width, state.map.height)) return false;
      return state.hexes.owner[hexId(neighborHex, state.map.width)] !== owner;
    });
    if (adjacent) border[owner]?.push(hex);
  });
  return { owned, border };
}

/**
 * Строит производные данные для всех решений ботов одного тика.
 * @returns списки сущностей по игрокам и общие агрегаты тика
 */
export function createBotTickContext(state: MatchState): BotTickContext {
  const unitsByHex = Array.from({ length: state.hexes.owner.length }, () => [] as Unit[]);
  const unitsByPlayer = playerLists<Unit>(state.players.length);
  const armiesByPlayer = playerLists<Army>(state.players.length);
  const citiesByPlayer = playerLists<City>(state.players.length);
  const plansByPlayer = playerLists<ArmyPlan>(state.players.length);
  const armyOwners = new Map<number, number>();
  for (const unit of state.units) {
    unitsByPlayer[unit.owner]?.push(unit);
    unitsByHex[unit.hex]?.push(unit);
  }
  for (const army of state.armies) {
    armiesByPlayer[army.owner]?.push(army);
    armyOwners.set(army.id, army.owner);
  }
  for (const city of state.cities) citiesByPlayer[city.owner]?.push(city);
  for (const plan of state.plans) {
    const owner = armyOwners.get(plan.armyId);
    if (owner !== undefined) plansByPlayer[owner]?.push(plan);
  }
  const hexes = mapOwnedHexes(state);
  const playerView = createPlayerViewContext(state);
  return {
    playerView,
    incomeBases: playerView.incomeBases,
    ownedHexes: hexes.owned,
    borderHexes: hexes.border,
    unitsByHex,
    unitsByPlayer,
    armiesByPlayer,
    citiesByPlayer,
    plansByPlayer,
    networks: state.networks,
  };
}
