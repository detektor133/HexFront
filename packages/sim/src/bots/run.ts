// Запуск автокомандования вне step (CR-006; architecture/sim-core.md, «Commander»): раз в
// COMMANDER_TICKS для каждого живого игрока — все его армии с auto в один тик, по одному снимку;
// игроки распределены по тикам: тик игрока — id mod COMMANDER_TICKS. Команды уходят в следующий тик
// с source 'auto' — они не выключают auto. Вызывают локальный движок, комната сервера и golden.
import { brainDecide, type BotWeightsByPlayer } from './brain.ts';
import { createCommanderContext, decide } from './commander.ts';
import { createBotTickContext, type BotTickContext } from './context.ts';
import {
  BOT_EASY_THINK_TICKS,
  BOT_LINE_MAX_DEPTH,
  BOT_THINK_TICKS,
  COMMANDER_TICKS,
} from '../balance.ts';
import type { BotLevel } from './types.ts';
import type { PlayerCommand } from '../commands/types.ts';
import type { Fp } from '../math/int.ts';
import { commanderView } from '../queries/player-view.ts';
import type { MatchState } from '../state/types.ts';
export type { BotLevel } from './types.ts';

function isBotTickContext(
  value: readonly (BotLevel | undefined)[] | BotTickContext | undefined,
): value is BotTickContext {
  return value !== undefined && !Array.isArray(value);
}

function botArguments(
  levelsOrContext: readonly (BotLevel | undefined)[] | BotTickContext | undefined,
  shared: BotTickContext | undefined,
): { levels: readonly (BotLevel | undefined)[]; context: BotTickContext | undefined } {
  if (Array.isArray(levelsOrContext)) return { levels: levelsOrContext, context: shared };
  return { levels: [], context: isBotTickContext(levelsOrContext) ? levelsOrContext : shared };
}

/**
 * Команды commander на этот тик: игроки, чей это тик, — все их армии с автокомандованием.
 * @returns команды по порядку игроков и армий (id по возрастанию)
 */
export function commanderCommands(
  state: MatchState,
  bots: readonly number[] = [],
  levelsOrContext?: readonly (BotLevel | undefined)[] | BotTickContext,
  shared?: BotTickContext,
): PlayerCommand[] {
  const out: PlayerCommand[] = [];
  const { context } = botArguments(levelsOrContext, shared);
  const tickContext = context ?? createBotTickContext(state);
  const viewContext = tickContext.playerView;
  const armiesByOwner = new Map<number, number[]>();
  for (const army of state.armies) {
    if (!army.auto) continue;
    const armies = armiesByOwner.get(army.owner) ?? [];
    armies.push(army.id);
    armiesByOwner.set(army.owner, armies);
  }
  const botIds = new Set(bots);
  const turn = state.tick % COMMANDER_TICKS;
  const cities = state.cities.map((c) => ({
    id: c.id,
    hex: c.hex,
    owner: c.owner,
    level: c.level,
    name: c.name,
    isCapital: state.players[c.owner]?.capitalCityId === c.id,
    isolated: false,
    defenders: c.defenders,
    defenseOrg: c.defenseOrg,
    recruitMax: 0 as Fp,
    canRebuild: false,
  }));
  for (const p of state.players) {
    if (p.status !== 'alive' || p.id % COMMANDER_TICKS !== turn) continue;
    const armies = armiesByOwner.get(p.id) ?? [];
    if (armies.length === 0) continue;
    const view = commanderView(state, p.id, viewContext, cities);
    const commanderContext = createCommanderContext(state.map, view, tickContext.ownedHexes[p.id]);
    for (const armyId of armies) {
      const depth = botIds.has(p.id) ? BOT_LINE_MAX_DEPTH : undefined;
      for (const cmd of decide(
        state.map,
        view,
        armyId,
        depth,
        commanderContext,
        botIds.has(p.id),
      )) {
        out.push({ playerId: p.id, cmd, source: 'auto' });
      }
    }
  }
  return out;
}

/**
 * Команды экономического мозга ботов на этот тик (09-bots.md): раз в BOT_THINK_TICKS на бота, тик
 * бота — id mod BOT_THINK_TICKS. Армиями ботов командует commander (commanderCommands).
 * @returns команды по порядку id ботов
 */
export function botCommands(
  state: MatchState,
  bots: readonly number[],
  levelsOrContext?: readonly (BotLevel | undefined)[] | BotTickContext,
  shared?: BotTickContext,
  weights?: BotWeightsByPlayer,
): PlayerCommand[] {
  const out: PlayerCommand[] = [];
  const { levels, context } = botArguments(levelsOrContext, shared);
  const tickContext = context ?? createBotTickContext(state);
  for (const p of state.players) {
    if (p.status !== 'alive' || !bots.includes(p.id)) continue;
    const level = levels[p.id] ?? 'medium';
    const thinkTicks = level === 'easy' ? BOT_EASY_THINK_TICKS : BOT_THINK_TICKS;
    if (p.id % thinkTicks !== state.tick % thinkTicks) continue;
    const commands = brainDecide(state, p.id, tickContext, level, weights);
    for (const cmd of commands) {
      out.push({ playerId: p.id, cmd });
    }
  }
  return out;
}
