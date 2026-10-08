import { RECRUIT_STEP } from '../balance.ts';
import type { BotTickContext } from './context.ts';
import { recruitCapacity } from '../commands/recruit.ts';
import { neighbors, hexFromId, hexId, inBounds, type HexId } from '../math/hex.ts';
import { type Fp } from '../math/int.ts';
import type { MatchState } from '../state/types.ts';
import { playerIncomePerSecond, playerUpkeepPerSecond } from '../systems/economy.ts';

export interface BotContact {
  readonly enemy: number;
  readonly mine: Fp;
  readonly theirs: Fp;
}

export interface BotSnapshot {
  readonly playerId: number;
  readonly gold: Fp;
  readonly incomePerS: number;
  readonly upkeepPerS: number;
  readonly contacts: readonly BotContact[];
  readonly freeCities: readonly number[];
}

function visibleEnemy(state: MatchState, playerId: number, hex: HexId): boolean {
  return !state.fog || state.vision?.visible[playerId]?.[hex] === 1;
}

function contactHexes(
  state: MatchState,
  context: BotTickContext,
  playerId: number,
): Map<number, Set<HexId>> {
  const contacts = new Map<number, Set<HexId>>();
  for (const mine of context.borderHexes[playerId] ?? []) {
    for (const neighbor of neighbors(hexFromId(mine, state.map.width))) {
      if (!inBounds(neighbor, state.map.width, state.map.height)) continue;
      const hex = hexId(neighbor, state.map.width);
      const enemy = state.hexes.owner[hex] ?? -1;
      if (enemy < 0 || enemy === playerId) continue;
      const theirs = contacts.get(enemy) ?? new Set<HexId>();
      theirs.add(hex);
      contacts.set(enemy, theirs);
    }
  }
  return contacts;
}

function soldiersAt(
  context: BotTickContext,
  hexes: ReadonlySet<HexId>,
  owner: number,
  visible: (hex: HexId) => boolean,
): Fp {
  let soldiers = 0;
  for (const hex of hexes) {
    if (!visible(hex)) continue;
    for (const unit of context.unitsByHex[hex] ?? []) {
      if (unit.owner === owner) soldiers += unit.soldiers;
    }
  }
  return soldiers as Fp;
}

function freeCities(state: MatchState, context: BotTickContext, playerId: number): number[] {
  const busy = new Set(state.recruits.map((recruitment) => recruitment.cityId));
  return (context.citiesByPlayer[playerId] ?? [])
    .filter((city) => !busy.has(city.id))
    .filter((city) => recruitCapacity(state, city.id) >= RECRUIT_STEP)
    .map((city) => city.id);
}

/**
 * Строит компактный снимок бота из общего контекста тика.
 * @returns экономика и силы на видимых участках границы
 */
export function createBotSnapshot(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
): BotSnapshot {
  const visible = (hex: HexId): boolean => visibleEnemy(state, playerId, hex);
  const contacts = [...contactHexes(state, context, playerId)]
    .map(([enemy, theirsHexes]) => ({
      enemy,
      mine: soldiersAt(
        context,
        new Set(
          (context.borderHexes[playerId] ?? []).filter((mine) =>
            neighbors(hexFromId(mine, state.map.width)).some(
              (neighbor) =>
                inBounds(neighbor, state.map.width, state.map.height) &&
                state.hexes.owner[hexId(neighbor, state.map.width)] === enemy,
            ),
          ),
        ),
        playerId,
        () => true,
      ),
      theirs: soldiersAt(context, theirsHexes, enemy, visible),
    }))
    .sort((a, b) => a.enemy - b.enemy);
  const player = state.players[playerId];
  return {
    playerId,
    gold: player?.gold ?? (0 as Fp),
    incomePerS: playerIncomePerSecond(state, playerId, undefined, context.incomeBases),
    upkeepPerS: playerUpkeepPerSecond(state, playerId),
    contacts,
    freeCities: freeCities(state, context, playerId),
  };
}
