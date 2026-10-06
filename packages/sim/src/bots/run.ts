// Запуск автокомандования вне step (CR-006; architecture/sim-core.md, «Commander»): раз в
// COMMANDER_TICKS для каждого живого игрока — все его армии с auto в один тик, по одному снимку;
// игроки распределены по тикам: тик игрока — id mod COMMANDER_TICKS. Команды уходят в следующий тик
// с source 'auto' — они не выключают auto. Вызывают локальный движок, комната сервера и golden.
import { createCommanderContext, decide } from './commander.ts';
import { economyDecide } from './economy.ts';
import { BOT_LINE_MAX_DEPTH, BOT_THINK_TICKS, COMMANDER_TICKS } from '../balance.ts';
import type { PlayerCommand } from '../commands/types.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';
import {
  commanderView,
  createPlayerViewContext,
  playerView,
  type PlayerViewContext,
} from '../queries/player-view.ts';
import type { MatchState } from '../state/types.ts';

function indexOwnedHexes(state: MatchState): Map<number, HexId[]> {
  const result = new Map<number, HexId[]>();
  state.hexes.owner.forEach((owner, hex) => {
    if (owner < 0) return;
    const hexes = result.get(owner) ?? [];
    hexes.push(hex);
    result.set(owner, hexes);
  });
  return result;
}

/**
 * Команды commander на этот тик: игроки, чей это тик, — все их армии с автокомандованием.
 * @returns команды по порядку игроков и армий (id по возрастанию)
 */
export function commanderCommands(
  state: MatchState,
  bots: readonly number[] = [],
  shared?: PlayerViewContext,
): PlayerCommand[] {
  const out: PlayerCommand[] = [];
  const viewContext = shared ?? createPlayerViewContext(state);
  const ownedHexes = indexOwnedHexes(state);
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
    const commanderContext = createCommanderContext(state.map, view, ownedHexes.get(p.id));
    for (const armyId of armies) {
      const depth = botIds.has(p.id) ? BOT_LINE_MAX_DEPTH : undefined;
      for (const cmd of decide(state.map, view, armyId, depth, commanderContext)) {
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
  shared?: PlayerViewContext,
): PlayerCommand[] {
  const out: PlayerCommand[] = [];
  const viewContext = shared ?? createPlayerViewContext(state);
  const turn = state.tick % BOT_THINK_TICKS;
  for (const p of state.players) {
    if (p.status !== 'alive' || !bots.includes(p.id) || p.id % BOT_THINK_TICKS !== turn) continue;
    for (const cmd of economyDecide(state.map, playerView(state, p.id, viewContext))) {
      out.push({ playerId: p.id, cmd });
    }
  }
  return out;
}
