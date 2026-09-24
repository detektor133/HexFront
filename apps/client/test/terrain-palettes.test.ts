import { describe, expect, it } from 'vitest';

import { deltaE2000, toLab } from './color-math.ts';
import { mixWithWhite } from '../src/dev/fake-territories.ts';
import { TERRAIN_CANDIDATES } from '../src/theme/terrain-candidates.ts';
import { tokens } from '../src/theme/tokens.ts';

const LAND = ['plains', 'forest', 'hills', 'mountains', 'desert'] as const;
const MIN_DELTA_E = 8;

const territoryL = tokens.players.palette.map(
  (p) => toLab(mixWithWhite(p.line, tokens.territory.fillMix))[0],
);

describe('кандидаты палитры местности', () => {
  it('CIEDE2000 совпадает с эталонной парой Sharma и др. (2005)', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
  });

  it.each(TERRAIN_CANDIDATES.map((p) => [p.id, p] as const))(
    'палитра %s: ΔE2000 между типами суши и до воды ≥ 8',
    (_id, p) => {
      const kinds = [...LAND, 'water'] as const;
      for (const a of kinds) {
        for (const b of kinds) {
          if (a >= b) continue;
          expect(deltaE2000(toLab(p[a]), toLab(p[b])), `${a}–${b}`).toBeGreaterThanOrEqual(
            MIN_DELTA_E,
          );
        }
      }
    },
  );

  it.each(TERRAIN_CANDIDATES.map((p) => [p.id, p] as const))(
    'палитра %s: вся суша светлее любой заливки территории',
    (_id, p) => {
      const maxTerritory = Math.max(...territoryL);
      for (const k of LAND) expect(toLab(p[k])[0], k).toBeGreaterThan(maxTerritory);
    },
  );
});
