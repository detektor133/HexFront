import { neighborTable, SIDES } from '../map/neighbor-table.ts';
import type { HexId } from '../math/hex.ts';
import { createPlayerViewContext, type PlayerViewContext } from '../queries/player-view.ts';
import { memo } from '../state/derived.ts';
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

function computeOwnedHexes(state: MatchState): { owned: HexId[][]; border: HexId[][] } {
  const owned = playerLists<HexId>(state.players.length);
  const border = playerLists<HexId>(state.players.length);
  const table = neighborTable(state.map);
  const ownerOf = state.hexes.owner;
  for (let hex = 0; hex < ownerOf.length; hex += 1) {
    const owner = ownerOf[hex] as number;
    if (owner < 0 || owner >= owned.length) continue;
    owned[owner]?.push(hex);
    let adjacent = false;
    for (let d = 0; d < SIDES && !adjacent; d += 1) {
      const n = table[hex * SIDES + d] as number;
      adjacent = n >= 0 && ownerOf[n] !== owner;
    }
    if (adjacent) border[owner]?.push(hex);
  }
  return { owned, border };
}

// Участки игроков зависят только от слоя владельцев: пересобираем при захвате, а не каждый тик.
function mapOwnedHexes(state: MatchState): { owned: HexId[][]; border: HexId[][] } {
  return memo(state, 'ownedHexes', ['owner'], () => computeOwnedHexes(state));
}

/**
 * Строит производные данные для всех решений ботов одного тика.
 * @returns списки сущностей по игрокам и общие агрегаты тика
 */
export function createBotTickContext(state: MatchState): BotTickContext {
  const unitsByPlayer = playerLists<Unit>(state.players.length);
  const armiesByPlayer = playerLists<Army>(state.players.length);
  const citiesByPlayer = playerLists<City>(state.players.length);
  const plansByPlayer = playerLists<ArmyPlan>(state.players.length);
  const armyOwners = new Map<number, number>();
  for (const unit of state.units) unitsByPlayer[unit.owner]?.push(unit);
  for (const army of state.armies) {
    armiesByPlayer[army.owner]?.push(army);
    armyOwners.set(army.id, army.owner);
  }
  for (const city of state.cities) citiesByPlayer[city.owner]?.push(city);
  for (const plan of state.plans) {
    const owner = armyOwners.get(plan.armyId);
    if (owner !== undefined) plansByPlayer[owner]?.push(plan);
  }
  // Тяжёлые части (списки гексов, отряды по гексам, доходы) считаются только когда кто-то из ботов
  // их спросил: в большинстве тиков никто не думает, и строить их впустую стоило пятую долю тика.
  let hexes: ReturnType<typeof mapOwnedHexes> | undefined;
  let byHex: Unit[][] | undefined;
  let view: PlayerViewContext | undefined;
  const mapped = (): ReturnType<typeof mapOwnedHexes> => (hexes ??= mapOwnedHexes(state));
  const viewContext = (): PlayerViewContext => (view ??= createPlayerViewContext(state));
  return {
    get playerView() {
      return viewContext();
    },
    get incomeBases() {
      return viewContext().incomeBases;
    },
    get ownedHexes() {
      return mapped().owned;
    },
    get borderHexes() {
      return mapped().border;
    },
    get unitsByHex() {
      if (!byHex) {
        byHex = new Array<Unit[] | undefined>(state.hexes.owner.length) as Unit[][];
        for (const unit of state.units) (byHex[unit.hex] ??= []).push(unit);
      }
      return byHex;
    },
    unitsByPlayer,
    armiesByPlayer,
    citiesByPlayer,
    plansByPlayer,
    networks: state.networks,
  };
}
