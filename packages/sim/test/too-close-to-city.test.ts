import { describe, expect, it } from 'vitest';

import small from '../../mapgen/maps/small.json' with { type: 'json' };
import { CITY_MIN_DISTANCE } from '../src/balance.ts';
import { commanderCommands } from '../src/bots/run.ts';
import { tooCloseToCity } from '../src/commands/construction.ts';
import { loadMap } from '../src/map/load.ts';
import { distance, hexFromId } from '../src/math/hex.ts';
import { createMatch } from '../src/state/create-match.ts';
import { step } from '../src/step.ts';

const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));

// Эталон: прямой перебор всех городов и строящихся городов, как до маски.
function reference(state: ReturnType<typeof createMatch>, hex: number): boolean {
  const { width } = state.map;
  const at = hexFromId(hex, width);
  const near = (h: number): boolean => distance(hexFromId(h, width), at) < CITY_MIN_DISTANCE;
  return (
    state.cities.some((c) => near(c.hex)) ||
    state.constructions.some((c) => c.kind === 'foundCity' && near(c.hex))
  );
}

describe('близость к городу (маска вместо перебора)', () => {
  it('совпадает с перебором на всех гексах, пока матч растёт и основываются города', () => {
    const state = createMatch(
      loaded.map,
      Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })),
      11,
    );
    for (let tick = 0; tick < 600; tick += 1) {
      step(state, commanderCommands(state));
      if (tick % 50 !== 0) continue;
      for (let hex = 0; hex < state.hexes.owner.length; hex += 1) {
        expect(tooCloseToCity(state, hex), `тик ${tick}, гекс ${hex}`).toBe(reference(state, hex));
      }
    }
  }, 60_000);
});
