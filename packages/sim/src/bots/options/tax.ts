import {
  currentTax,
  hasOptionState,
  option,
  playerOptionMetrics,
  relativeEffects,
} from './helpers.ts';
import type { BotOptionDefinitions, CommandOption } from './types.ts';
import { TAX_MAX, TAX_MIN, TAX_STEP } from '../../balance.ts';
import { validateSetTax } from '../../commands/set-tax.ts';
import { type Fp } from '../../math/int.ts';
import type { MatchState } from '../../state/types.ts';
import { playerIncomePerSecond } from '../../systems/economy.ts';
import { taxGrowthMult } from '../../systems/tax.ts';
import type { BotTickContext } from '../context.ts';

export function taxOptions(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  _definitions: BotOptionDefinitions,
): readonly CommandOption[] {
  if (!hasOptionState(state, context)) return [];
  const target = currentTax(state, playerId);
  const result: CommandOption[] = [];
  const metrics = playerOptionMetrics(state, playerId, context, _definitions);
  for (let rate: number = TAX_MIN; rate <= TAX_MAX; rate += TAX_STEP) {
    const tax = rate as Fp;
    if (tax === target || !validateSetTax(tax).ok) continue;
    result.push(
      option(
        { t: 'setTax', rate: tax },
        'tax',
        relativeEffects(
          {
            income: (playerIncomePerSecond(state, playerId, tax, context.incomeBases) -
              playerIncomePerSecond(state, playerId, target, context.incomeBases)) as Fp,
            growth: (taxGrowthMult(tax) - taxGrowthMult(target)) as Fp,
          },
          metrics,
        ),
      ),
    );
  }
  return result;
}
