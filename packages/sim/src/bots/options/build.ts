import type { BotOptionDefinitions, CommandOption } from './types.ts';
import { BUILDING_DEFS } from '../../balance.ts';
import { checkConstruction } from '../../commands/construction.ts';
import { distance, hexFromId, hexId, inBounds, neighbors } from '../../math/hex.ts';
import { isFort } from '../../state/fort.ts';
import { atWar } from '../../state/relations.ts';
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
import { FP, fpMul, intDiv } from '../../math/int.ts';

/** Укреплений не больше двух и не больше половины числа городов: страну ими не застраивают. */
function fortBudget(playerId: number, context: BotTickContext): number {
  return Math.max(2, intDiv((context.citiesByPlayer[playerId] ?? []).length, 2));
}

/**
 * Укрепление нужно только на гексе у врага: рядом (не дальше двух гексов) отряд или земля игрока,
 * с которым война, — и пока бюджет укреплений не выбран.
 */
function fortWanted(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  hex: number,
): boolean {
  let forts = 0;
  for (const h of context.ownedHexes[playerId] ?? []) {
    if (isFort(state.hexes.building[h] ?? 0)) forts += 1;
  }
  for (const c of state.constructions) {
    if (c.owner === playerId && c.kind === 'fort') forts += 1;
  }
  if (forts >= fortBudget(playerId, context)) return false;
  const origin = hexFromId(hex, state.map.width);
  const hostile = (owner: number): boolean =>
    owner >= 0 && owner !== playerId && atWar(state, playerId, owner);
  for (const unit of state.units) {
    if (hostile(unit.owner) && distance(origin, hexFromId(unit.hex, state.map.width)) <= 2) {
      return true;
    }
  }
  for (const n of neighbors(origin)) {
    if (!inBounds(n, state.map.width, state.map.height)) continue;
    if (hostile(state.hexes.owner[hexId(n, state.map.width)] ?? -1)) return true;
  }
  return false;
}

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
      if (kind === 'fort' && !fortWanted(state, playerId, context, hex)) continue;
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
