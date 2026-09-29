// Запуск автокомандования вне step (CR-006; architecture/sim-core.md, «Commander»): раз в
// COMMANDER_TICKS для каждого живого игрока — все его армии с auto в один тик, по одному снимку;
// игроки распределены по тикам: тик игрока — id mod COMMANDER_TICKS. Команды уходят в следующий тик
// с source 'auto' — они не выключают auto. Вызывают локальный движок, комната сервера и golden.
import { decide } from './commander.ts';
import { economyDecide } from './economy.ts';
import { BOT_THINK_TICKS, COMMANDER_TICKS } from '../balance.ts';
import type { PlayerCommand } from '../commands/types.ts';
import { playerView } from '../queries/player-view.ts';
import type { MatchState } from '../state/types.ts';

/**
 * Команды commander на этот тик: игроки, чей это тик, — все их армии с автокомандованием.
 * @returns команды по порядку игроков и армий (id по возрастанию)
 */
export function commanderCommands(state: MatchState): PlayerCommand[] {
  const out: PlayerCommand[] = [];
  const turn = state.tick % COMMANDER_TICKS;
  for (const p of state.players) {
    if (p.status !== 'alive' || p.id % COMMANDER_TICKS !== turn) continue;
    const armies = state.armies.filter((a) => a.owner === p.id && a.auto);
    if (armies.length === 0) continue;
    const view = playerView(state, p.id);
    for (const a of armies) {
      for (const cmd of decide(state.map, view, a.id)) {
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
export function botCommands(state: MatchState, bots: readonly number[]): PlayerCommand[] {
  const out: PlayerCommand[] = [];
  const turn = state.tick % BOT_THINK_TICKS;
  for (const p of state.players) {
    if (p.status !== 'alive' || !bots.includes(p.id) || p.id % BOT_THINK_TICKS !== turn) continue;
    for (const cmd of economyDecide(state.map, playerView(state, p.id))) {
      out.push({ playerId: p.id, cmd });
    }
  }
  return out;
}
