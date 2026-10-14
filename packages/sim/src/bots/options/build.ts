import type { BotOptionDefinitions, CommandOption } from './types.ts';
import { BUILDING_DEFS } from '../../balance.ts';
import { checkConstruction } from '../../commands/construction.ts';
import { distance, hexFromId } from '../../math/hex.ts';
import type { MatchState } from '../../state/types.ts';
import type { BotTickContext } from '../context.ts';
import {
  customBuildingIsValid,
  hasOptionState,
  option,
  playerOptionMetrics,
  relativeEffects,
  ZERO,
} from './helpers.ts';
import { FP, fpMul } from '../../math/int.ts';

export function buildOptions(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  definitions: BotOptionDefinitions,
): readonly CommandOption[] {
  if (!hasOptionState(state, context)) return [];
  const result: CommandOption[] = [];
  const cityHexes = new Set((context.citiesByPlayer[playerId] ?? []).map((city) => city.hex));
  const hexes = [...new Set([...(context.borderHexes[playerId] ?? []), ...cityHexes])].sort(
    (a, b) => a - b,
  );
  const units = context.unitsByPlayer[playerId] ?? [];
  for (const hex of hexes) {
    const origin = hexFromId(hex, state.map.width);
    for (const [kind, definition] of Object.entries(definitions.buildings)) {
      const command = { t: 'build', hex, kind: kind as keyof typeof BUILDING_DEFS } as const;
      const check = Object.hasOwn(BUILDING_DEFS, kind)
        ? checkConstruction(state, playerId, command)
        : null;
      if (check ? !check.ok : !customBuildingIsValid(state, playerId, hex, definition)) continue;
      const soldiers = (context.unitsByHex[hex] ?? [])
        .filter((unit) => unit.owner === playerId)
        .reduce((sum, unit) => (sum + unit.soldiers) as typeof ZERO, ZERO);
      const supply = units.reduce(
        (sum, unit) =>
          distance(origin, hexFromId(unit.hex, state.map.width)) <= definition.supplyRadius
            ? ((sum - unit.soldiers) as typeof ZERO)
            : sum,
        ZERO,
      );
      result.push(
        option(
          command,
          `hex:${hex}`,
          relativeEffects(
            {
              cost: definition.costGold,
              defense: fpMul((definition.defenseMult - FP) as typeof ZERO, soldiers),
              supply:
                supply === 0
                  ? ZERO
                  : fpMul((FP - definition.supplyLossMult) as typeof ZERO, -supply as typeof ZERO),
            },
            playerOptionMetrics(state, playerId, context, definitions),
          ),
        ),
      );
    }
  }
  return result;
}
