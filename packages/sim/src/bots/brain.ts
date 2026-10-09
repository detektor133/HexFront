import {
  BOT_ATTACK_MIN_RATIO,
  BOT_ATTACK_STOP_RATIO,
  BOT_EASY_TAX,
  BOT_GOLD_RESERVE,
  BOT_MAX_SPENDS,
  BOT_TAX_PEACE,
  BOT_TAX_WAR,
  BUILDING_DEFS,
  COST_GOLD_PER_SOLDIER,
  RECRUIT_MIN,
  TAX_MAX,
  UPKEEP_GOLD_PER_SOLDIER_S,
  type UnitType,
} from '../balance.ts';
import { createActionCatalog, type BotAction } from './actions.ts';
import type { BotTickContext } from './context.ts';
import { actionFeatures, type ActionFeatureContext, type ActionFeatures } from './features.ts';
import { createBotSnapshot } from './snapshot.ts';
import type { BotLevel } from './types.ts';
import weights from './weights.json' with { type: 'json' };
import { checkConstruction } from '../commands/construction.ts';
import { rebuildSupplyPlan } from '../commands/rebuild-supply.ts';
import { checkRecruit } from '../commands/recruit.ts';
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
    const army = state.armies.find((candidate) => candidate.id === plan.armyId);
    if (army?.owner !== playerId) continue;
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

function actionContext(snapshot: ReturnType<typeof createBotSnapshot>): ActionFeatureContext {
  const contact = snapshot.contacts.reduce(
    (strongest, current) => (current.theirs > strongest.theirs ? current : strongest),
    { mine: 0, theirs: 0 } as { mine: Fp; theirs: Fp },
  );
  const total = (contact.mine + contact.theirs) as Fp;
  const runway = fpMul(snapshot.incomePerS as Fp, 60 as Fp);
  return {
    gold: snapshot.gold,
    incomePerS: snapshot.incomePerS as Fp,
    upkeepPerS: snapshot.upkeepPerS as Fp,
    strength: Math.max(1, contact.mine) as Fp,
    threat: total === 0 ? (0 as Fp) : fpDiv(contact.theirs, total),
    goldReserve:
      snapshot.gold + runway === 0
        ? (0 as Fp)
        : fpDiv(snapshot.gold, (snapshot.gold + runway) as Fp),
    neutralBorderShare: 0 as Fp,
    ownSoldiers: contact.mine,
    enemySoldiers: contact.theirs,
    enemyCities: snapshot.contacts.length,
  };
}

function commandForAction(action: BotAction): Command | null {
  switch (action.kind) {
    case 'recruit':
      return action.unitType === undefined
        ? null
        : {
            t: 'recruit',
            cityId: action.targetId,
            type: action.unitType as UnitType,
            soldiers: RECRUIT_MIN,
          };
    case 'build':
      return action.buildingType === 'fort' || action.buildingType === 'depot'
        ? { t: 'build', hex: action.targetId, kind: action.buildingType }
        : null;
    case 'upgradeCity':
      return { t: 'upgradeCity', cityId: action.targetId };
    case 'improve':
      return { t: 'improve', hex: action.targetId };
    case 'foundCity':
      return { t: 'foundCity', hex: action.targetId };
    case 'rebuildSupply':
      return { t: 'rebuildSupply', cityId: action.targetId };
    default:
      return null;
  }
}

function commandCost(state: MatchState, playerId: number, command: Command): Fp | null {
  if (command.t === 'recruit') {
    const check = checkRecruit(state, playerId, command.cityId, command.type, command.soldiers);
    return check.ok || check.reason === 'notEnoughGold' ? (check.cost ?? null) : null;
  }
  if (
    command.t === 'foundCity' ||
    command.t === 'upgradeCity' ||
    command.t === 'improve' ||
    command.t === 'build'
  ) {
    const check = checkConstruction(state, playerId, command);
    return check.ok || check.reason === 'notEnoughGold' ? (check.cost ?? null) : null;
  }
  if (command.t === 'rebuildSupply') {
    const plan = rebuildSupplyPlan(state, playerId, command.cityId);
    return plan.ok ? plan.cost : null;
  }
  return null;
}

function actionTarget(state: MatchState, action: BotAction): string {
  if (action.kind === 'build' || action.kind === 'improve' || action.kind === 'foundCity') {
    return `hex:${action.targetId}`;
  }
  const city = state.cities.find((candidate) => candidate.id === action.targetId);
  return `hex:${city?.hex ?? action.targetId}`;
}

function spendCommands(
  state: MatchState,
  playerId: number,
  snapshot: ReturnType<typeof createBotSnapshot>,
  context: BotTickContext,
): Command[] {
  const player = state.players[playerId];
  if (!player || player.gold <= BOT_GOLD_RESERVE) return [];
  const units = {
    infantry: {
      costGoldPerSoldier: COST_GOLD_PER_SOLDIER.infantry,
      upkeepGoldPerSoldierS: UPKEEP_GOLD_PER_SOLDIER_S.infantry,
      attack: 0 as Fp,
      defense: 0 as Fp,
      supplyPerSoldier: 0 as Fp,
    },
    armor: {
      costGoldPerSoldier: COST_GOLD_PER_SOLDIER.armor,
      upkeepGoldPerSoldierS: UPKEEP_GOLD_PER_SOLDIER_S.armor,
      attack: 0 as Fp,
      defense: 0 as Fp,
      supplyPerSoldier: 0 as Fp,
    },
    artillery: {
      costGoldPerSoldier: COST_GOLD_PER_SOLDIER.artillery,
      upkeepGoldPerSoldierS: UPKEEP_GOLD_PER_SOLDIER_S.artillery,
      attack: 0 as Fp,
      defense: 0 as Fp,
      supplyPerSoldier: 0 as Fp,
    },
  };
  const catalog = createActionCatalog({
    units,
    buildings: BUILDING_DEFS,
    cityIds: context.citiesByPlayer[playerId]?.map((city) => city.id) ?? [],
    borderHexes: context.borderHexes[playerId] ?? [],
    cityHexes: context.citiesByPlayer[playerId]?.map((city) => city.hex) ?? [],
    improveHexes: context.ownedHexes[playerId] ?? [],
    foundHexes: context.ownedHexes[playerId] ?? [],
    supplyCityIds: context.citiesByPlayer[playerId]?.map((city) => city.id) ?? [],
    taxRates: [],
    armies: [],
    recruitSoldiers: RECRUIT_MIN,
  });
  const pricedCatalog = catalog.flatMap((action) => {
    const command = commandForAction(action);
    const cost = command === null ? null : commandCost(state, playerId, command);
    return cost === null ? [] : [{ ...action, costGold: cost }];
  });
  const commands: Command[] = [];
  const targets = new Set<string>();
  let availableGold = player.gold;
  const ranked = [
    ...pricedCatalog.filter((action) => action.kind === 'rebuildSupply'),
    ...rankActions(
      pricedCatalog.filter((action) => action.kind !== 'rebuildSupply'),
      actionContext(snapshot),
    ),
  ];
  for (const action of ranked) {
    if (commands.length >= BOT_MAX_SPENDS) break;
    const command = commandForAction(action);
    if (!command || targets.has(actionTarget(state, action))) continue;
    const cost = commandCost(state, playerId, command);
    if (cost === null || availableGold < cost + BOT_GOLD_RESERVE) continue;
    commands.push(command);
    targets.add(actionTarget(state, action));
    availableGold = (availableGold - cost) as Fp;
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
  if (!player.bankrupt) commands.push(...spendCommands(state, playerId, snapshot, context));
  return commands;
}
