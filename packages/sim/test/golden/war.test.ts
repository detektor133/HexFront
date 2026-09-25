import { describe, expect, it } from 'vitest';

import { WAR_TICKS, warCommands } from './war-script.ts';
import small from '../../../mapgen/maps/small.json' with { type: 'json' };
import { loadMap } from '../../src/map/load.ts';
import { createMatch } from '../../src/state/create-match.ts';
import { hashState } from '../../src/state/hash.ts';
import { step } from '../../src/step.ts';
import { invariantViolations } from '../invariants/invariants.ts';

interface Result {
  readonly hash: string;
  readonly battleTicks: number;
  readonly retreats: number;
  readonly captured: number;
  readonly violations: readonly string[];
}

function run(): Result {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const state = createMatch(loaded.map, [{ name: 'A' }, { name: 'B' }], 42);
  let battleTicks = 0;
  let retreats = 0;
  let captured = 0;
  const violations: string[] = [];
  for (let t = 0; t < WAR_TICKS; t += 1) {
    step(state, warCommands(state));
    if (state.units.some((u) => u.inBattle)) battleTicks += 1;
    for (const e of state.events) {
      if (e.t === 'unitRetreated' || e.t === 'unitCapitulated') retreats += 1;
      if (e.t === 'cityCaptured') captured += 1;
    }
    if (violations.length === 0) violations.push(...invariantViolations(state));
  }
  return { hash: hashState(state), battleTicks, retreats, captured, violations };
}

describe('golden-реплей «война двух игроков 5 минут» на small', () => {
  const result = run();

  it('идёт настоящая война: бои, отступления, инварианты целы', () => {
    expect(result.violations).toEqual([]);
    expect(result.battleTicks).toBeGreaterThan(100);
    expect(result.retreats).toBeGreaterThan(0);
  });

  it('конечное состояние совпадает с эталоном', () => {
    expect(result.hash).toBe('9cac7c8d');
  });

  it('повторный прогон даёт тот же хэш', () => {
    expect(run().hash).toBe(result.hash);
  }, 30_000);
});
