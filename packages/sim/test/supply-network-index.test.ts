import { describe, expect, it } from 'vitest';

import { warCommands, WAR_TICKS } from './golden/war-script.ts';
import { cloneState } from './invariants/clone.ts';
import small from '../../mapgen/maps/small.json' with { type: 'json' };
import { loadMap } from '../src/map/load.ts';
import { createMatch } from '../src/state/create-match.ts';
import { recomputeAllNetworks } from '../src/state/network.ts';
import { recalculateSupply } from '../src/state/supply.ts';
import { rebuildUnitIndex } from '../src/state/unit-index.ts';
import { step } from '../src/step.ts';

const map = (() => {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  return loaded.map;
})();

function supplySnapshot(state: ReturnType<typeof createMatch>): unknown {
  return {
    network: [...state.hexes.network],
    networks: state.networks,
    ratios: [...state.supplyRatios.entries()].sort(([a], [b]) => a - b),
    units: state.units.map((unit) => [unit.id, unit.supplyLevel, unit.encircled]),
  };
}

describe('инкрементальные снабжение и сети', () => {
  it('совпадают с полным пересчётом после захватов, движения и боёв', () => {
    const state = createMatch(map, [{ name: 'A' }, { name: 'B' }], 42);
    rebuildUnitIndex(state);

    for (let tick = 0; tick < WAR_TICKS; tick += 1) {
      step(state, warCommands(state));
      if (tick % 20 !== 0) continue;
      recomputeAllNetworks(state);
      for (const player of state.players) recalculateSupply(state, player.id);
      const reference = cloneState(state);
      recomputeAllNetworks(reference);
      for (const player of reference.players) recalculateSupply(reference, player.id);
      expect(supplySnapshot(state)).toEqual(supplySnapshot(reference));
    }
  }, 30_000);
});
