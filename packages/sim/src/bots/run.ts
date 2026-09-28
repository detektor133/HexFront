// Запуск автокомандования вне step (CR-006; architecture/sim-core.md, «Commander»): раз в
// COMMANDER_TICKS для каждой армии с auto живого игрока, со смещением по id армии. Команды уходят в
// следующий тик с source 'auto' — они не выключают auto. Вызывают локальный движок, комната сервера
// и golden-сценарии.
import { decide } from './commander.ts';
import { COMMANDER_TICKS } from '../balance.ts';
import type { PlayerCommand } from '../commands/types.ts';
import { playerView, type PlayerView } from '../queries/player-view.ts';
import type { MatchState } from '../state/types.ts';

/**
 * Команды commander на этот тик для всех армий с автокомандованием.
 * @returns команды по порядку армий (id по возрастанию)
 */
export function commanderCommands(state: MatchState): PlayerCommand[] {
  const out: PlayerCommand[] = [];
  const views = new Map<number, PlayerView>();
  for (const a of state.armies) {
    if (!a.auto || (state.tick + a.id) % COMMANDER_TICKS !== 0) continue;
    if (state.players[a.owner]?.status !== 'alive') continue;
    let view = views.get(a.owner);
    if (!view) {
      view = playerView(state, a.owner);
      views.set(a.owner, view);
    }
    for (const cmd of decide(state.map, view, a.id)) {
      out.push({ playerId: a.owner, cmd, source: 'auto' });
    }
  }
  return out;
}
