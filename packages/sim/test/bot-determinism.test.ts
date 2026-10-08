import { describe, expect, it } from 'vitest';

import small from '../../mapgen/maps/small.json' with { type: 'json' };
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  hashState,
  loadMap,
  step,
  type PlayerCommand,
} from '../src/index.ts';

const TICKS = 1200;
const PLAYERS = 6;
const SEED = 42;

function runBotMatch(): { hash: string; commands: PlayerCommand[][] } {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const state = createMatch(
    loaded.map,
    Array.from({ length: PLAYERS }, (_, id) => ({ name: `P${id}` })),
    SEED,
  );
  const bots = state.players.map((player) => player.id);
  const commands: PlayerCommand[][] = [];

  for (let tick = 0; tick < TICKS; tick += 1) {
    const context = createBotTickContext(state);
    const tickCommands = [
      ...commanderCommands(state, bots, context),
      ...botCommands(state, bots, context),
    ];
    commands.push(tickCommands);
    step(state, tickCommands);
  }

  return { hash: hashState(state), commands };
}

describe('детерминизм полного прогона ботов', () => {
  it('повторяет команды и хэш состояния за 1200 тиков', () => {
    const first = runBotMatch();
    const second = runBotMatch();

    expect(second.commands).toEqual(first.commands);
    expect(second.hash).toBe(first.hash);
  }, 30_000);
});
