// Детерминированный сценарий «10 минут развития без войны» для golden-реплея этапа 02
// и графика в отчёте (tools/replay). Решения — только по состоянию матча, без случайности.
import { checkConstruction } from '../../src/commands/construction.ts';
import type { Command, PlayerCommand } from '../../src/commands/types.ts';
import { distance, hexFromId } from '../../src/math/hex.ts';
import type { Fp } from '../../src/math/int.ts';
import { canFoundCity } from '../../src/queries/city.ts';
import type { MatchState } from '../../src/state/types.ts';

/** Длина реплея: 10 минут при 10 тиках в секунду. */
export const DEVELOPMENT_TICKS = 6000;
/** Решения принимаются раз в 10 с. */
const DECIDE_EVERY = 100;
/** До этого тика налог 0 % (рост), потом 20 %. */
const LOW_TAX_UNTIL = 1800;
const IMPROVE_RADIUS = 2;

function pick(state: MatchState, playerId: number): Command | null {
  const { owner } = state.hexes;
  for (let hex = 0; hex < owner.length; hex += 1) {
    if (owner[hex] === playerId && canFoundCity(state, playerId, hex).ok)
      return { t: 'foundCity', hex };
  }
  const capital = state.cities.find((c) => c.id === state.players[playerId]?.capitalCityId);
  if (!capital) return null;
  const upgrade: Command = { t: 'upgradeCity', cityId: capital.id };
  if (checkConstruction(state, playerId, upgrade).ok) return upgrade;
  const center = hexFromId(capital.hex, state.map.width);
  for (let hex = 0; hex < owner.length; hex += 1) {
    if (owner[hex] !== playerId) continue;
    if (distance(hexFromId(hex, state.map.width), center) > IMPROVE_RADIUS) continue;
    const improve: Command = { t: 'improve', hex };
    if (checkConstruction(state, playerId, improve).ok) return improve;
  }
  return null;
}

/** Команды всех игроков на этот тик (пусто между моментами решений). */
export function developmentCommands(state: MatchState): PlayerCommand[] {
  if (state.tick % DECIDE_EVERY !== 0) return [];
  const commands: PlayerCommand[] = [];
  for (const p of state.players) {
    if (state.tick === 0) commands.push({ playerId: p.id, cmd: { t: 'setTax', rate: 0 as Fp } });
    if (state.tick === LOW_TAX_UNTIL) {
      commands.push({ playerId: p.id, cmd: { t: 'setTax', rate: 200 as Fp } });
    }
    const cmd = pick(state, p.id);
    if (cmd) commands.push({ playerId: p.id, cmd });
  }
  return commands;
}
