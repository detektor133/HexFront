import {
  BOT_ARMY_INCOME_SHARE,
  BOT_ATTACK_MIN_RATIO,
  BOT_ATTACK_STOP_RATIO,
  BOT_EASY_TAX,
  BOT_GOLD_RESERVE,
  BOT_GOLD_TARGET,
  BOT_MAX_SPENDS,
  BOT_TAX_PEACE,
  BOT_TAX_WAR,
  CITY_UPGRADE_COST,
  COST_GOLD_PER_SOLDIER,
  RECRUIT_MIN,
  RECRUIT_STEP,
  TAX_MAX,
  UPKEEP_GOLD_PER_SOLDIER_S,
} from '../balance.ts';
import type { BotAction } from './actions.ts';
import type { BotTickContext } from './context.ts';
import { actionFeatures, type ActionFeatureContext, type ActionFeatures } from './features.ts';
import { createBotSnapshot } from './snapshot.ts';
import type { BotLevel } from './types.ts';
import weights from './weights.json' with { type: 'json' };
import { rebuildSupplyPlan } from '../commands/rebuild-supply.ts';
import { recruitCapacity } from '../commands/recruit.ts';
import type { Command } from '../commands/types.ts';
import { fpDiv, fpMul, type Fp } from '../math/int.ts';
import { edgeOther } from '../state/edges.ts';
import type { MatchState } from '../state/types.ts';

export type ActionFeatureName = keyof ActionFeatures;
export type BotWeights = Partial<Record<ActionFeatureName, number>>;

export const BOT_WEIGHTS: BotWeights = weights;

/**
 * Оценивает действие суммой `вес × признак`; вес — целое число, признак — fixed-point.
 * @returns оценка действия в масштабе fixed-point (1000 = 1,0)
 */
export function scoreAction(
  action: BotAction,
  context: ActionFeatureContext,
  botWeights: BotWeights = BOT_WEIGHTS,
): number {
  const features = actionFeatures(action, context);
  let score = 0;
  for (const name of Object.keys(features) as ActionFeatureName[]) {
    score += (botWeights[name] ?? 0) * features[name];
  }
  return score;
}

/**
 * Отбирает положительные оценки и сортирует их по оценке, каталогу и id цели.
 * @returns действия в порядке исполнения решения бота
 */
export function rankActions(
  actions: readonly BotAction[],
  context: ActionFeatureContext,
  botWeights: BotWeights = BOT_WEIGHTS,
): BotAction[] {
  return actions
    .map((action) => ({ action, score: scoreAction(action, context, botWeights) }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.action.order - right.action.order ||
        left.action.targetId - right.action.targetId,
    )
    .map(({ action }) => action);
}

function taxCommand(state: MatchState, playerId: number, war: boolean): Command[] {
  const player = state.players[playerId];
  if (!player) return [];
  const rate = player.gold < BOT_GOLD_RESERVE && !war ? TAX_MAX : war ? BOT_TAX_WAR : BOT_TAX_PEACE;
  return player.taxTarget === rate ? [] : [{ t: 'setTax', rate }];
}

function offensiveCommands(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  easy: boolean,
): Command[] {
  if (easy) return [];
  const contacts = new Map(
    createBotSnapshot(state, playerId, context).contacts.map((contact) => [contact.enemy, contact]),
  );
  const ground = { map: state.map, hexes: state.hexes };
  const commands: Command[] = [];
  for (const plan of state.plans) {
    if (plan.kind !== 'front') continue;
    const enemies = new Set(
      plan.edges
        .map((edge) => edgeOther(ground, edge))
        .map((hex) => state.hexes.owner[hex] ?? -1)
        .filter((enemy) => enemy >= 0 && enemy !== playerId),
    );
    const target = [...enemies].sort((a, b) => a - b)[0];
    const contact = target === undefined ? undefined : contacts.get(target);
    if (!contact || contact.theirs <= 0) continue;
    const ratio = fpDiv(contact.mine, contact.theirs);
    if (plan.offensive?.active && ratio < BOT_ATTACK_STOP_RATIO) {
      commands.push({ t: 'stopOffensive', armyId: plan.armyId });
    } else if (!plan.offensive && ratio >= BOT_ATTACK_MIN_RATIO) {
      commands.push({ t: 'startOffensive', armyId: plan.armyId });
    }
  }
  return commands;
}

function recruitCommand(
  state: MatchState,
  playerId: number,
  snapshot: ReturnType<typeof createBotSnapshot>,
): Command | null {
  const player = state.players[playerId];
  if (!player) return null;
  const incomeBudget = fpMul(snapshot.incomePerS as Fp, BOT_ARMY_INCOME_SHARE);
  const upkeepFree = Math.max(0, incomeBudget - snapshot.upkeepPerS) as Fp;
  const affordUpkeep = fpDiv(upkeepFree, UPKEEP_GOLD_PER_SOLDIER_S.infantry);
  const affordGold = fpDiv(
    Math.max(0, player.gold - BOT_GOLD_RESERVE) as Fp,
    COST_GOLD_PER_SOLDIER.infantry,
  );
  const soldiers = Math.min(
    affordGold,
    affordUpkeep,
    ...snapshot.freeCities.map((cityId) => recruitCapacity(state, cityId)),
  );
  const amount = (soldiers - (soldiers % RECRUIT_STEP)) as Fp;
  const cityId = snapshot.freeCities[0];
  return cityId !== undefined && amount >= RECRUIT_MIN
    ? { t: 'recruit', cityId, type: 'infantry', soldiers: amount }
    : null;
}

function spendCommands(
  state: MatchState,
  playerId: number,
  snapshot: ReturnType<typeof createBotSnapshot>,
): Command[] {
  const player = state.players[playerId];
  if (!player || player.gold <= BOT_GOLD_TARGET) return [];
  const commands: Command[] = [];
  for (const city of state.cities
    .filter((value) => value.owner === playerId)
    .sort((a, b) => a.id - b.id)) {
    if (commands.length >= BOT_MAX_SPENDS) break;
    if (rebuildSupplyPlan(state, playerId, city.id).ok && player.gold > BOT_GOLD_RESERVE) {
      commands.push({ t: 'rebuildSupply', cityId: city.id });
    }
  }
  const recruit = recruitCommand(state, playerId, snapshot);
  if (recruit && commands.length < BOT_MAX_SPENDS) commands.push(recruit);
  for (const city of state.cities
    .filter((value) => value.owner === playerId)
    .sort((a, b) => a.level - b.level || a.id - b.id)) {
    if (commands.length >= BOT_MAX_SPENDS) break;
    const cost = CITY_UPGRADE_COST[city.level - 1];
    const busy = state.constructions.some((construction) => construction.hex === city.hex);
    if (cost !== undefined && !busy && player.gold > cost + BOT_GOLD_RESERVE) {
      commands.push({ t: 'upgradeCity', cityId: city.id });
    }
  }
  return commands;
}

/**
 * Принимает решение бота по компактному снимку и общему контексту.
 * @returns команды настройки, армии и нескольких трат
 */
export function brainDecide(
  state: MatchState,
  playerId: number,
  context: BotTickContext,
  level: BotLevel = 'medium',
): Command[] {
  const snapshot = createBotSnapshot(state, playerId, context);
  const player = state.players[playerId];
  if (!player) return [];
  const easy = level === 'easy';
  const commands: Command[] = player.autoReinforce ? [] : [{ t: 'setAutoReinforce', on: true }];
  const easyTax: Command[] = [{ t: 'setTax', rate: BOT_EASY_TAX }];
  commands.push(...(easy ? easyTax : taxCommand(state, playerId, snapshot.contacts.length > 0)));
  commands.push(...offensiveCommands(state, playerId, context, easy));
  if (!player.bankrupt) commands.push(...spendCommands(state, playerId, snapshot));
  return commands;
}
