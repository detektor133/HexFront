import type { BotTickContext } from './context.ts';
import { actionFeatures, type ActionFeatureContext } from './features.ts';
import {
  commandOptions,
  COMMAND_OPTIONS,
  DEFAULT_BOT_OPTION_DEFINITIONS,
} from './options/index.ts';
import type { CommandOption, CommandOptionEntry } from './options/types.ts';
import type { BotOptionDefinitions } from './options/types.ts';
import { createBotSnapshot } from './snapshot.ts';
import type { Command } from '../commands/types.ts';
import { fpMul, type Fp } from '../math/int.ts';
import type { MatchState } from '../state/types.ts';

export type ActionFeatureName = string;
export type BotWeights = Readonly<Record<ActionFeatureName, number>>;

export const BOT_WEIGHTS: BotWeights = {};

function scoreOption(
  option: CommandOption,
  context: ActionFeatureContext,
  weights: BotWeights,
): number {
  const features = actionFeatures(option, context);
  let score = 0;
  for (const [name, value] of Object.entries(features)) {
    score += (weights[name] ?? 0) * value;
  }
  return score;
}

function rankOptions(
  options: readonly CommandOption[],
  context: ActionFeatureContext,
  weights: BotWeights,
): readonly { option: CommandOption; score: number; order: number }[] {
  return options
    .map((option, order) => ({ option, score: scoreOption(option, context, weights), order }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order);
}

function optionContext(snapshot: ReturnType<typeof createBotSnapshot>): ActionFeatureContext {
  return {
    threat: snapshot.threat,
    goldSeconds: snapshot.goldSeconds,
    neutralBorderShare: snapshot.neutralBorderShare,
  };
}

function optionCost(option: CommandOption, gold: Fp): Fp {
  const relativeCost = option.effects.cost;
  return relativeCost === undefined || relativeCost >= 0
    ? (0 as Fp)
    : fpMul(-relativeCost as Fp, gold);
}

function selectOptions(
  options: readonly CommandOption[],
  context: ActionFeatureContext,
  weights: BotWeights,
  gold: Fp,
): readonly Command[] {
  const ranked = rankOptions(options, context, weights);
  const selected = new Map<string, { option: CommandOption; score: number; order: number }>();
  for (const entry of ranked) {
    if (!selected.has(entry.option.group)) selected.set(entry.option.group, entry);
  }
  let availableGold = gold;
  return [...selected.values()]
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .filter((entry) => {
      const cost = optionCost(entry.option, gold);
      if (cost > availableGold) return false;
      availableGold = (availableGold - cost) as Fp;
      return true;
    })
    .map((entry) => entry.option.command);
}

/**
 * Строит, оценивает и выбирает варианты только через переданный реестр.
 * @returns команды бота в порядке исполнения
 */
export function planBotActions(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  weights: BotWeights = BOT_WEIGHTS,
  options: readonly CommandOptionEntry[] = COMMAND_OPTIONS,
  definitions: BotOptionDefinitions = DEFAULT_BOT_OPTION_DEFINITIONS,
): Command[] {
  const player = state.players[playerId];
  if (!player) return [];
  if (options === COMMAND_OPTIONS && Object.keys(weights).length === 0) {
    return player.autoReinforce ? [] : [{ t: 'setAutoReinforce', on: true }];
  }
  const snapshot = createBotSnapshot(state, playerId, context);
  const candidates =
    options === COMMAND_OPTIONS
      ? commandOptions(state, playerId, context, definitions)
      : options.flatMap((entry) => entry.options(state, playerId, context, definitions));
  const commands = [...selectOptions(candidates, optionContext(snapshot), weights, player.gold)];
  return player.autoReinforce
    ? commands
    : ([{ t: 'setAutoReinforce', on: true }, ...commands] as Command[]);
}

/**
 * Принимает решение бота через единый планировщик вариантов.
 * @returns команды настройки и экономических действий
 */
export function brainDecide(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  _level: 'easy' | 'medium' = 'medium',
  botWeights: BotWeights = BOT_WEIGHTS,
): Command[] {
  return planBotActions(state, playerId, context, botWeights);
}

export function scoreAction(
  action: CommandOption,
  context: ActionFeatureContext,
  weights: BotWeights = BOT_WEIGHTS,
): number {
  return scoreOption(action, context, weights);
}

export function rankActions(
  actions: readonly CommandOption[],
  context: ActionFeatureContext,
  weights: BotWeights = BOT_WEIGHTS,
): CommandOption[] {
  return rankOptions(actions, context, weights).map((entry) => entry.option);
}
