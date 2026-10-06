import { describe, expect, it } from 'vitest';

import { warCommands, WAR_TICKS } from './golden/war-script.ts';
import small from '../../mapgen/maps/small.json' with { type: 'json' };
import { splitUnit, mergeUnits } from '../src/commands/unit.ts';
import { loadMap } from '../src/map/load.ts';
import { FP, type Fp } from '../src/math/int.ts';
import { createMatch } from '../src/state/create-match.ts';
import { indexMatchesUnits, rebuildUnitIndex } from '../src/state/unit-index.ts';
import { step } from '../src/step.ts';
import { attritionSystem } from '../src/systems/attrition.ts';

const map = (() => {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  return loaded.map;
})();

describe('индекс отрядов для запросов пути', () => {
  it('совпадает с полным построением после операций и 3000 тиков войны', () => {
    const state = createMatch(map, [{ name: 'A' }, { name: 'B' }], 42);
    rebuildUnitIndex(state);
    const first = state.units[0];
    if (!first) throw new Error('не создан стартовый отряд');

    const part = splitUnit(state, first, (FP * 10) as Fp);
    mergeUnits(state, [first, part]);
    expect(indexMatchesUnits(state)).toBe(true);

    part.soldiers = 0 as Fp;
    attritionSystem(state);
    expect(indexMatchesUnits(state)).toBe(true);

    for (let tick = 0; tick < WAR_TICKS; tick += 1) {
      step(state, warCommands(state));
      expect(indexMatchesUnits(state)).toBe(true);
    }
  }, 30_000);
});
