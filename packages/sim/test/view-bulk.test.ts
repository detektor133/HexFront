import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import small from '../../mapgen/maps/small.json' with { type: 'json' };
import { commanderCommands } from '../src/bots/run.ts';
import { loadMap } from '../src/map/load.ts';
import { playerScore, playerScores } from '../src/queries/score.ts';
import { createMatch } from '../src/state/create-match.ts';
import { step } from '../src/step.ts';
import { growthPerSecond, hexGrowthPerSecond } from '../src/systems/population.ts';

const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const MAP = loaded.map;

// Матч 4 игроков под commander: территория, города и отряды меняются, как в игре.
function matchAt(ticks: number, tax: number) {
  const state = createMatch(
    MAP,
    Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })),
    11,
  );
  for (const p of state.players) p.taxEffective = tax as typeof p.taxEffective;
  for (let i = 0; i < ticks; i += 1) step(state, commanderCommands(state));
  return state;
}

describe('снимок игрока одним проходом (04/T21, бюджет commander)', () => {
  it('рост населения всех гексов совпадает с расчётом по одному гексу', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 600 }), fc.integer({ min: 0, max: 1000 }), (t, tax) => {
        const state = matchAt(t, tax);
        const bulk = growthPerSecond(state);
        const one = Int32Array.from(state.hexes.pop, (_, id) => hexGrowthPerSecond(state, id));
        expect(bulk).toEqual(one);
      }),
      { numRuns: 8, seed: 21 },
    );
  }, 60_000);

  it('очки всех игроков совпадают с playerScore', () => {
    const state = matchAt(300, 200);
    expect([...playerScores(state)]).toEqual(state.players.map((p) => playerScore(state, p.id)));
  }, 30_000);
});
