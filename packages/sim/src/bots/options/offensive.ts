import { validatePlanCommand } from '../../commands/plan.ts';
import { fpDiv, fp, type Fp } from '../../math/int.ts';
import { edgeOther } from '../../state/edges.ts';
import type { MatchState } from '../../state/types.ts';
import type { BotTickContext } from '../context.ts';
import { hasOptionState, option } from './helpers.ts';
import type { BotOptionDefinitions, CommandOption } from './types.ts';

function offensiveOptions(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  active: boolean,
): readonly CommandOption[] {
  if (!hasOptionState(state, context)) return [];
  const result: CommandOption[] = [];
  for (const army of context.armiesByPlayer[playerId] ?? []) {
    const plan = context.plansByPlayer[playerId]?.find((candidate) => candidate.armyId === army.id);
    if (plan?.kind !== 'front' || (plan.offensive?.active ?? false) !== active) continue;
    const command = { t: active ? 'stopOffensive' : 'startOffensive', armyId: army.id } as const;
    if (!validatePlanCommand(state, playerId, command).ok) continue;
    const frontHexes = new Set(
      plan.edges.map((edge) => edgeOther({ map: state.map, hexes: state.hexes }, edge)),
    );
    const enemyOwners = new Set(
      [...frontHexes]
        .map((hex) => state.hexes.owner[hex] ?? -1)
        .filter((owner) => owner >= 0 && owner !== playerId),
    );
    const mine = (context.unitsByPlayer[playerId] ?? [])
      .filter((unit) => unit.armyId === army.id)
      .reduce((sum, unit) => (sum + unit.soldiers) as Fp, 0 as Fp);
    const theirs = (context.unitsByPlayer ?? [])
      .flat()
      .filter((unit) => enemyOwners.has(unit.owner) && frontHexes.has(unit.hex))
      .reduce((sum, unit) => (sum + unit.soldiers) as Fp, 0 as Fp);
    const enemyCities = (context.citiesByPlayer ?? [])
      .filter((_cities, owner) => enemyOwners.has(owner))
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
