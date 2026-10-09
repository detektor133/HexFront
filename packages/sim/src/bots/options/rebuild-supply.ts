import { ISOLATED_INCOME_MULT } from '../../balance.ts';
import { rebuildSupplyPlan } from '../../commands/rebuild-supply.ts';
import { fpDiv, type Fp } from '../../math/int.ts';
import { cityGold } from '../../state/city-output.ts';
import type { MatchState } from '../../state/types.ts';
import type { BotTickContext } from '../context.ts';
import { hasOptionState, option, playerOptionMetrics, relativeEffects } from './helpers.ts';
import type { BotOptionDefinitions, CommandOption } from './types.ts';

export function rebuildSupplyOptions(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  _definitions: BotOptionDefinitions,
): readonly CommandOption[] {
  if (!hasOptionState(state)) return [];
  const result: CommandOption[] = [];
  const metrics = playerOptionMetrics(state, playerId, context, _definitions);
  for (const city of context.citiesByPlayer[playerId] ?? []) {
    const plan = rebuildSupplyPlan(state, playerId, city.id);
    if (!plan.ok) continue;
    result.push(
      option(
        { t: 'rebuildSupply', cityId: city.id },
        `city:${city.id}`,
        relativeEffects(
          {
            cost: plan.cost,
            income: (fpDiv(cityGold(state, city), ISOLATED_INCOME_MULT) -
              cityGold(state, city)) as Fp,
          },
          metrics,
        ),
      ),
    );
  }
  return result;
}
