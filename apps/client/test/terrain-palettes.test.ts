import { describe, expect, it } from 'vitest';

import { deltaE2000, toLab } from './color-math.ts';
import { mixWithWhite } from '../src/dev/fake-territories.ts';
import { tokens } from '../src/theme/tokens.ts';

const LAND = ['plains', 'forest', 'hills', 'mountains', 'desert'] as const;
const MIN_DELTA_E = 8;
const T = tokens.map.terrain;
const colorOf = (k: (typeof LAND)[number] | 'water'): string =>
  k === 'water' ? tokens.map.water : T[k];

// Требования владельца к палитре местности (DECISIONS 2026-09-24).
describe('палитра местности', () => {
  it('CIEDE2000 совпадает с эталонной парой Sharma и др. (2005)', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
  });

  it('ΔE2000 между любыми типами суши и до воды ≥ 8', () => {
    const kinds = [...LAND, 'water'] as const;
    kinds.forEach((a, i) => {
      for (const b of kinds.slice(i + 1)) {
        expect(
          deltaE2000(toLab(colorOf(a)), toLab(colorOf(b))),
          `${a}–${b}`,
        ).toBeGreaterThanOrEqual(MIN_DELTA_E);
      }
    });
  });

  it('вся суша светлее любой заливки территории игрока', () => {
    const maxTerritory = Math.max(
      ...tokens.players.palette.map(
        (p) => toLab(mixWithWhite(p.line, tokens.territory.fillMix))[0],
      ),
    );
    for (const k of LAND) expect(toLab(T[k])[0], k).toBeGreaterThan(maxTerritory);
  });

  it('своё государство прозрачнее чужих', () => {
    expect(tokens.territory.alphaOwn).toBeLessThan(tokens.territory.alphaOther);
  });
});
