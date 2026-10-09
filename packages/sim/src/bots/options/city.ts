import { CITY_GOLD_PER_LEVEL } from '../../balance.ts';
import { checkConstruction } from '../../commands/construction.ts';
import type { Fp } from '../../math/int.ts';
import { cityGold } from '../../state/city-output.ts';
import { cityPopCap, hexPopCap } from '../../state/pop-cap.ts';
import type { MatchState } from '../../state/types.ts';
import { incomePerSecond } from '../../systems/economy.ts';
import type { BotTickContext } from '../context.ts';
import { hasOptionState, option, playerOptionMetrics, relativeEffects, ZERO } from './helpers.ts';
import type { BotOptionDefinitions, CommandOption } from './types.ts';

function constructionOption(
  state: MatchState,
  playerId: number,
  command: Parameters<typeof checkConstruction>[2],
  group: string,
  effects: Readonly<Record<string, Fp>>,
  metrics: ReturnType<typeof playerOptionMetrics>,
): CommandOption | null {
  const check = checkConstruction(state, playerId, command);
  return check.ok
    ? option(command, group, relativeEffects({ cost: check.cost, ...effects }, metrics))
    : null;
}

export function cityOptions(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  _definitions: BotOptionDefinitions,
): readonly CommandOption[] {
  if (!hasOptionState(state, context)) return [];
  const result: CommandOption[] = [];
  const metrics = playerOptionMetrics(state, playerId, context, _definitions);
  for (const city of context.citiesByPlayer[playerId] ?? []) {
    const upgrade = constructionOption(
      state,
      playerId,
      { t: 'upgradeCity', cityId: city.id },
      `hex:${city.hex}`,
      {
        income:
          city.level < 5
            ? ((cityGold(state, { ...city, level: city.level + 1 }) -
                cityGold(state, city) +
                incomePerSecond(
                  cityPopCap(city.level + 1) - cityPopCap(city.level),
                  state.players[playerId]?.taxTarget ?? ZERO,
                  0,
                )) as Fp)
            : ZERO,
      },
      metrics,
    );
    if (upgrade) result.push(upgrade);
  }
  if (!state.map || !state.hexes) return result;
  for (const hex of context.ownedHexes[playerId] ?? []) {
    const improvement = new Uint8Array(state.hexes.improvement);
    improvement[hex] = (improvement[hex] ?? 0) + 1;
    const improvedCap = (hexPopCap({ map: state.map, hexes: { improvement } }, hex) -
      hexPopCap(state, hex)) as Fp;
    const improve = constructionOption(
      state,
      playerId,
      { t: 'improve', hex },
      `hex:${hex}`,
      {
        income: incomePerSecond(improvedCap, state.players[playerId]?.taxTarget ?? ZERO, 0) as Fp,
      },
      metrics,
    );
    if (improve) result.push(improve);
    const found = constructionOption(
      state,
      playerId,
      { t: 'foundCity', hex },
      `hex:${hex}`,
      {
        income: (CITY_GOLD_PER_LEVEL +
          incomePerSecond(
            cityPopCap(1) - hexPopCap(state, hex),
            state.players[playerId]?.taxTarget ?? ZERO,
            0,
          )) as Fp,
      },
      metrics,
    );
    if (found) result.push(found);
  }
  return result;
}
