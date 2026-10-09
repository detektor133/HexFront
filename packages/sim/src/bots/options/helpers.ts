import type { BotOptionDefinitions, CommandOption } from './types.ts';
import {
  ATK,
  BUILDING_DEFS,
  COST_GOLD_PER_SOLDIER,
  DEF,
  DEPOT_RADIUS,
  SUPPLY_PER_SOLDIER,
  UPKEEP_GOLD_PER_SOLDIER_S,
  UPKEEP_GOLD_PER_UNIT_S,
  RECRUIT_MIN,
  RECRUIT_STEP,
  type UnitType,
} from '../../balance.ts';
import { recruitCapacity } from '../../commands/recruit.ts';
import type { Command } from '../../commands/types.ts';
import { fpDiv, fpMul, type Fp } from '../../math/int.ts';
import { cityGold } from '../../state/city-output.ts';
import type { MatchState } from '../../state/types.ts';
import { BUILDING } from '../../state/types.ts';
import { playerIncomePerSecond, playerUpkeepPerSecond } from '../../systems/economy.ts';
import type { BotTickContext } from '../context.ts';

export const ZERO = 0 as Fp;

export function valueRatio(value: Fp, denominator: Fp): Fp {
  return denominator === 0 ? ZERO : fpDiv(value, denominator);
}

export function playerGold(state: MatchState, playerId: number): Fp {
  return state.players?.[playerId]?.gold ?? ZERO;
}

export function playerIncome(state: MatchState, playerId: number, context: BotTickContext): Fp {
  return playerIncomePerSecond(state, playerId, undefined, context.incomeBases) as Fp;
}

export function playerUpkeep(state: MatchState, playerId: number): Fp {
  return playerUpkeepPerSecond(state, playerId) as Fp;
}

export interface PlayerOptionMetrics {
  readonly gold: Fp;
  readonly upkeep: Fp;
  readonly income: Fp;
  readonly strength: Fp;
  readonly defense: Fp;
  readonly supply: Fp;
}

export function playerOptionMetrics(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  definitions: BotOptionDefinitions,
): PlayerOptionMetrics {
  let strength = ZERO;
  let defense = ZERO;
  let supply = ZERO;
  for (const unit of context.unitsByPlayer[playerId] ?? []) {
    const definition = definitions.units[unit.type];
    if (!definition) continue;
    strength = (strength +
      fpMul(unit.soldiers, (definition.attack + definition.defense) as Fp)) as Fp;
    defense = (defense + fpMul(unit.soldiers, definition.defense)) as Fp;
    supply = (supply + fpMul(unit.soldiers, definition.supplyPerSoldier)) as Fp;
  }
  return {
    gold: playerGold(state, playerId),
    upkeep: playerUpkeep(state, playerId),
    income: playerIncome(state, playerId, context),
    strength,
    defense,
    supply,
  };
}

export function relativeEffects(
  effects: Readonly<Record<string, Fp>>,
  metrics: PlayerOptionMetrics,
): Record<string, Fp> {
  const denominators: Readonly<Record<string, Fp>> = {
    cost: metrics.gold,
    upkeep: metrics.upkeep,
    income: metrics.income,
    strength: metrics.strength,
    defense: metrics.defense,
    supply: metrics.supply,
  };
  return Object.fromEntries(
    Object.entries(effects).map(([key, value]) => [
      key,
      key in denominators ? valueRatio(value, denominators[key] ?? ZERO) : value,
    ]),
  );
}

export function hasOptionState(state: MatchState): boolean {
  return Boolean(state.map && state.hexes && state.players && state.cities && state.recruits);
}

export function customRecruitIsValid(
  state: MatchState,
  playerId: number,
  cityId: number,
  soldiers: Fp,
  definition: BotOptionDefinitions['units'][string],
): boolean {
  const city = state.cities.find((candidate) => candidate.id === cityId);
  if (!city || city.owner !== playerId || state.players[playerId]?.bankrupt) return false;
  if (state.recruits.some((recruitment) => recruitment.cityId === cityId)) return false;
  if (soldiers < RECRUIT_MIN || soldiers % RECRUIT_STEP !== 0) return false;
  return (
    recruitCapacity(state, cityId) >= soldiers &&
    playerGold(state, playerId) >= fpMul(definition.costGoldPerSoldier, soldiers)
  );
}

export function customBuildingIsValid(
  state: MatchState,
  playerId: number,
  hex: number,
  definition: BotOptionDefinitions['buildings'][string],
): boolean {
  return (
    state.hexes.owner[hex] === playerId &&
    state.hexes.building[hex] === BUILDING.none &&
    !state.constructions.some(
      (construction) => construction.hex === hex && construction.kind !== 'road',
    ) &&
    playerGold(state, playerId) >= definition.costGold
  );
}

export function defaultDefinitions(): BotOptionDefinitions {
  return {
    units: Object.fromEntries(
      (Object.keys(COST_GOLD_PER_SOLDIER) as UnitType[]).map((type) => [
        type,
        {
          costGoldPerSoldier: COST_GOLD_PER_SOLDIER[type],
          upkeepGoldPerSoldierS: UPKEEP_GOLD_PER_SOLDIER_S[type],
          upkeepGoldPerUnitS: UPKEEP_GOLD_PER_UNIT_S[type],
          attack: ATK[type],
          defense: DEF[type],
          supplyPerSoldier: SUPPLY_PER_SOLDIER[type],
        },
      ]),
    ),
    buildings: {
      fort: { ...BUILDING_DEFS.fort, supplyRadius: 0 },
      depot: { ...BUILDING_DEFS.depot, supplyRadius: DEPOT_RADIUS },
    },
  };
}

export function mergeEffects(
  effects: Readonly<Record<string, Fp>>,
  extra: Readonly<Record<string, Fp>>,
): Record<string, Fp> {
  return { ...effects, ...extra };
}

export function cityIncomeDelta(state: MatchState, _playerId: number, cityId: number): Fp {
  const city = state.cities?.find((candidate) => candidate.id === cityId);
  if (!city) return ZERO;
  return cityGold(state, city) as Fp;
}

export function incomeDeltaForPopulation(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  population: Fp,
): Fp {
  if (population === 0) return ZERO;
  const current = playerIncome(state, playerId, context);
  const player = state.players?.[playerId];
  if (!player) return ZERO;
  const bases = context.incomeBases[playerId];
  if (!bases) return ZERO;
  const nextBases = { ...bases, pop: bases.pop + population };
  return (playerIncomePerSecond(state, playerId, player.taxTarget, [nextBases]) - current) as Fp;
}

export function soldierStrength(
  context: BotTickContext,
  playerId: number,
  hex: number,
  definition: BotOptionDefinitions['units'][string],
): Fp {
  const soldiers = (context.unitsByHex[hex] ?? [])
    .filter((unit) => unit.owner === playerId)
    .reduce((sum, unit) => (sum + unit.soldiers) as Fp, ZERO);
  return fpMul(soldiers, (definition.attack + definition.defense) as Fp);
}

export function option(
  command: Command,
  group: string,
  effects: Readonly<Record<string, Fp>>,
): CommandOption {
  return { command, group, effects };
}

export function stateHexes(state: MatchState, values: readonly number[] | undefined): number[] {
  return (values ?? []).filter((hex) => state.hexes?.owner?.[hex] !== undefined);
}

export function currentTax(state: MatchState, playerId: number): Fp {
  return state.players?.[playerId]?.taxTarget ?? ZERO;
}

export function unitEffects(
  soldiers: Fp,
  definition: BotOptionDefinitions['units'][string],
): Record<string, Fp> {
  return {
    cost: fpMul(definition.costGoldPerSoldier, soldiers),
    upkeep: (fpMul(definition.upkeepGoldPerSoldierS, soldiers) +
      definition.upkeepGoldPerUnitS) as Fp,
    strength: fpMul(soldiers, (definition.attack + definition.defense) as Fp),
    supply: -fpMul(definition.supplyPerSoldier, soldiers) as Fp,
  };
}
