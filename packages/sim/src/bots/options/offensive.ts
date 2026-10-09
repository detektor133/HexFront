import { validatePlanCommand } from '../../commands/plan.ts';
import { fpDiv, fp, type Fp } from '../../math/int.ts';
import type { MatchState } from '../../state/types.ts';
import type { BotTickContext } from '../context.ts';
import { option } from './helpers.ts';
import type { BotOptionDefinitions, CommandOption } from './types.ts';

function offensiveOptions(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  active: boolean,
): readonly CommandOption[] {
  const result: CommandOption[] = [];
  for (const army of context.armiesByPlayer[playerId] ?? []) {
    const plan = context.plansByPlayer[playerId]?.find((candidate) => candidate.armyId === army.id);
    if (plan?.kind !== 'front' || (plan.offensive?.active ?? false) !== active) continue;
    const command = { t: active ? 'stopOffensive' : 'startOffensive', armyId: army.id } as const;
    if (!validatePlanCommand(state, playerId, command).ok) continue;
    const mine = (context.unitsByPlayer[playerId] ?? [])
      .filter((unit) => unit.armyId === army.id)
      .reduce((sum, unit) => (sum + unit.soldiers) as Fp, 0 as Fp);
    const theirs = (context.unitsByPlayer ?? [])
      .flat()
      .filter((unit) => unit.owner !== playerId)
      .reduce((sum, unit) => (sum + unit.soldiers) as Fp, 0 as Fp);
    const enemyCities = (context.citiesByPlayer ?? [])
      .filter((_cities, owner) => owner !== playerId)
      .reduce((sum, cities) => sum + cities.length, 0);
    result.push(
      option(command, `army:${army.id}`, {
        frontRatio: mine + theirs === 0 ? (0 as Fp) : fpDiv(mine, (mine + theirs) as Fp),
        enemyCities: fpDiv(fp(1), fp(1 + enemyCities)),
        activeOffensive: active ? fp(1) : (0 as Fp),
      }),
    );
  }
  return result;
}

export const startOffensiveOptions = (
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  _definitions: BotOptionDefinitions,
): readonly CommandOption[] => offensiveOptions(state, playerId, context, false);
export const stopOffensiveOptions = (
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  _definitions: BotOptionDefinitions,
): readonly CommandOption[] => offensiveOptions(state, playerId, context, true);
