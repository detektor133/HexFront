import { CITY_GOLD_PER_LEVEL, IMPROVEMENT_CAP_STEP } from '../../balance.ts';
import { checkConstruction } from '../../commands/construction.ts';
import { fpMul } from '../../math/int.ts';
import type { Fp } from '../../math/int.ts';
import { cityPopCap, hexPopCap } from '../../state/pop-cap.ts';
import type { MatchState } from '../../state/types.ts';
import type { BotTickContext } from '../context.ts';
import { option, ZERO } from './helpers.ts';
import type { BotOptionDefinitions, CommandOption } from './types.ts';
import { incomePerSecond } from '../../systems/economy.ts';

function constructionOption(
  state: MatchState,
  playerId: number,
  command: Parameters<typeof checkConstruction>[2],
  group: string,
  effects: Readonly<Record<string, Fp>>,
): CommandOption | null {
  if (!state.hexes) return option(command, group, effects);
  const check = checkConstruction(state, playerId, command);
  return check.ok ? option(command, group, { cost: check.cost, ...effects }) : null;
}

export function cityOptions(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  _definitions: BotOptionDefinitions,
): readonly CommandOption[] {
  const result: CommandOption[] = [];
  for (const city of context.citiesByPlayer[playerId] ?? []) {
    const upgrade = constructionOption(
      state,
      playerId,
      { t: 'upgradeCity', cityId: city.id },
      `hex:${city.hex}`,
      {
        income:
          city.level < 5
            ? ((CITY_GOLD_PER_LEVEL +
                incomePerSecond(
                  cityPopCap(city.level + 1) - cityPopCap(city.level),
                  state.players[playerId]?.taxTarget ?? ZERO,
                  0,
                )) as Fp)
            : ZERO,
      },
    );
    if (upgrade) result.push(upgrade);
  }
  if (!state.map || !state.hexes) return result;
  for (const hex of context.ownedHexes[playerId] ?? []) {
    const improvedCap = fpMul(hexPopCap(state, hex), IMPROVEMENT_CAP_STEP);
    const improve = constructionOption(state, playerId, { t: 'improve', hex }, `hex:${hex}`, {
      income: incomePerSecond(improvedCap, state.players[playerId]?.taxTarget ?? ZERO, 0) as Fp,
    });
    if (improve) result.push(improve);
    const found = constructionOption(state, playerId, { t: 'foundCity', hex }, `hex:${hex}`, {
      income: (CITY_GOLD_PER_LEVEL +
        incomePerSecond(
          cityPopCap(1) - hexPopCap(state, hex),
          state.players[playerId]?.taxTarget ?? ZERO,
          0,
        )) as Fp,
    });
    if (found) result.push(found);
  }
  return result;
}
