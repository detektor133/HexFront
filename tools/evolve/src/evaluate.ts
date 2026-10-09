import type { EvolutionWeights } from './types.ts';
import { generateMap } from '../../../packages/mapgen/src/index.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  loadMap,
  step,
  type MatchState,
} from '../../../packages/sim/src/index.ts';

const PLAYERS = 6;

function scoreState(state: MatchState): number {
  const ownedHexes = state.hexes.owner.reduce((sum, owner) => sum + (owner >= 0 ? 1 : 0), 0);
  const gold = state.players.reduce((sum, player) => sum + Math.trunc(player.gold / 1000), 0);
  const winnerBonus = state.winner >= 0 ? 100_000 : 0;
  return winnerBonus + ownedHexes * 100 + gold;
}

/**
 * Оценивает набор весов на детерминированных матчах.
 * @returns целочисленный fitness, одинаковый для одинаковых весов и сидов
 */
export function evaluateWeights(
  weights: EvolutionWeights,
  seeds: readonly number[],
  ticks: number,
): number {
  let fitness = 0;
  for (const seed of seeds) {
    const loaded = loadMap(generateMap(seed, { players: PLAYERS }));
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    const state = createMatch(
      loaded.map,
      Array.from({ length: PLAYERS }, (_, id) => ({ name: `P${id}` })),
      seed,
      { fog: false },
    );
    const bots = state.players.map((player) => player.id);
    for (let tick = 0; tick < ticks && state.winner < 0; tick += 1) {
      const context = createBotTickContext(state);
      step(state, [
        ...commanderCommands(state, bots, context),
        ...botCommands(state, bots, context, undefined, weights),
      ]);
    }
    fitness += scoreState(state);
  }
  return fitness;
}
