import { buildOptions } from './build.ts';
import { cityOptions } from './city.ts';
import { startOffensiveOptions, stopOffensiveOptions } from './offensive.ts';
import { rebuildSupplyOptions } from './rebuild-supply.ts';
import { recruitOptions } from './recruit.ts';
import { taxOptions } from './tax.ts';
import type { BotOptionDefinitions, CommandOptionEntry } from './types.ts';
import {
  ATK,
  BUILDING_DEFS,
  COST_GOLD_PER_SOLDIER,
  DEF,
  DEPOT_RADIUS,
  SUPPLY_PER_SOLDIER,
  UPKEEP_GOLD_PER_SOLDIER_S,
  UPKEEP_GOLD_PER_UNIT_S,
  type UnitType,
} from '../../balance.ts';

export type {
  BotOptionDefinitions,
  BuildingOptionDefinition,
  CommandOption,
  UnitOptionDefinition,
} from './types.ts';

export const DEFAULT_BOT_OPTION_DEFINITIONS: BotOptionDefinitions = {
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

export const COMMAND_OPTIONS: readonly CommandOptionEntry[] = [
  { kind: 'recruit', options: recruitOptions },
  { kind: 'build', options: buildOptions },
  { kind: 'upgradeCity', options: cityOptions },
  { kind: 'improve', options: cityOptions },
  { kind: 'foundCity', options: cityOptions },
  { kind: 'rebuildSupply', options: rebuildSupplyOptions },
  { kind: 'setTax', options: taxOptions },
  { kind: 'startOffensive', options: startOffensiveOptions },
  { kind: 'stopOffensive', options: stopOffensiveOptions },
];

export function commandOptions(
  state: Parameters<CommandOptionEntry['options']>[0],
  playerId: number,
  context: Parameters<CommandOptionEntry['options']>[2],
  definitions: BotOptionDefinitions = DEFAULT_BOT_OPTION_DEFINITIONS,
): readonly ReturnType<CommandOptionEntry['options']>[number][] {
  return COMMAND_OPTIONS.flatMap((entry) => entry.options(state, playerId, context, definitions));
}
