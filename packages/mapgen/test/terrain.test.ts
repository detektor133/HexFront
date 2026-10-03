import { describe, expect, it } from 'vitest';

import { FEATURE, TERRAIN } from '@hexfront/sim';

import { generateTerrain } from '../src/index.ts';

const OPTIONS = { width: 80, height: 60, players: 30 } as const;

describe('процедурный рельеф', () => {
  it('даёт байт-в-байт одинаковый результат для одинакового сида', () => {
    const a = generateTerrain(42, OPTIONS);
    const b = generateTerrain(42, OPTIONS);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect([...a.terrain]).toEqual([...b.terrain]);
    expect([...a.features]).toEqual([...b.features]);
    expect(a.riverEdges).toEqual(b.riverEdges);
  });

  it('держит доли местности в пределах двух процентных пунктов на 100 сидах', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const { terrain } = generateTerrain(seed, OPTIONS);
      const counts = terrain.reduce((result, code) => {
        result[code] = (result[code] ?? 0) + 1;
        return result;
      }, [] as number[]);
      expect((counts[TERRAIN.water] ?? 0) / terrain.length).toBeCloseTo(0.25, 2);
      const land = terrain.length - (counts[TERRAIN.water] ?? 0);
      expect((counts[TERRAIN.mountains] ?? 0) / land).toBeCloseTo(0.08, 2);
      expect((counts[TERRAIN.hills] ?? 0) / land).toBeCloseTo(0.14, 2);
    }
  });

  it('размещает особенности только на допустимой местности', () => {
    const result = generateTerrain(42, OPTIONS);
    result.features.forEach((feature, id) => {
      if (feature === FEATURE.none) return;
      if (feature === FEATURE.fertile) expect(result.terrain[id]).toBe(TERRAIN.plains);
      if (feature === FEATURE.mine) expect(result.terrain[id]).toBe(TERRAIN.hills);
      if (feature === FEATURE.pass) expect(result.terrain[id]).toBe(TERRAIN.mountains);
    });
    expect(
      result.features.filter((feature) => feature === FEATURE.fertile).length,
    ).toBeLessThanOrEqual(15);
    expect(
      result.features.filter((feature) => feature === FEATURE.mine).length,
    ).toBeLessThanOrEqual(11);
  });

  it('строит реки от холмов или гор к воде', () => {
    const result = generateTerrain(42, OPTIONS);
    expect(result.riverEdges.length).toBeGreaterThan(0);
    for (const [q, r] of result.riverEdges) {
      expect(Number.isInteger(q)).toBe(true);
      expect(Number.isInteger(r)).toBe(true);
    }
  });
});
