import { COST_GOLD_PER_SOLDIER, RECRUIT_MIN, RECRUIT_STEP, type UnitType } from '../../balance.ts';
import { checkRecruit, recruitCapacity } from '../../commands/recruit.ts';
import { intDiv, type Fp } from '../../math/int.ts';
import type { MatchState } from '../../state/types.ts';
import type { BotTickContext } from '../context.ts';
import {
  customRecruitIsValid,
  hasOptionState,
  option,
  playerGold,
  playerOptionMetrics,
  relativeEffects,
  unitEffects,
} from './helpers.ts';
import type { BotOptionDefinitions, CommandOption } from './types.ts';

export function recruitOptions(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  definitions: BotOptionDefinitions,
): readonly CommandOption[] {
  if (!hasOptionState(state)) return [];
  const result: CommandOption[] = [];
  for (const city of context.citiesByPlayer[playerId] ?? []) {
    if (state.recruits?.some((recruitment) => recruitment.cityId === city.id)) continue;
    const capacity = recruitCapacity(state, city.id);
    for (const [type, definition] of Object.entries(definitions.units)) {
      const byGold =
        definition.costGoldPerSoldier === 0
          ? capacity
          : (intDiv(playerGold(state, playerId), definition.costGoldPerSoldier) as Fp);
      const soldiers = Math.max(
        RECRUIT_MIN,
        (intDiv(Math.min(capacity, byGold), RECRUIT_STEP) * RECRUIT_STEP) as Fp,
      ) as Fp;
      if (soldiers > capacity) continue;
      const command = { t: 'recruit', cityId: city.id, type: type as UnitType, soldiers } as const;
      const valid = Object.hasOwn(COST_GOLD_PER_SOLDIER, type)
        ? checkRecruit(state, playerId, city.id, type as UnitType, soldiers).ok
        : customRecruitIsValid(state, playerId, city.id, soldiers, definition);
      if (!valid) continue;
      result.push(
        option(
          command,
          `city:${city.id}`,
          relativeEffects(
            unitEffects(soldiers, definition),
            playerOptionMetrics(state, playerId, context, definitions),
          ),
        ),
      );
    }
  }
  return result;
}
