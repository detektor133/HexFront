import { describe, expect, it } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { loadMapJson } from '../src/local/map-request.ts';
import { quickMatchUrl } from '../src/routes.ts';

describe('случайные карты строятся на устройстве', () => {
  it('quickMatchUrl выдаёт новое зерно из диапазона протокола', () => {
    const seeds = new Set<number>();
    for (let index = 0; index < 20; index += 1) {
      const url = new URL(`http://localhost${quickMatchUrl()}`);
      const seed = Number(url.searchParams.get('seed'));
      expect(Number.isSafeInteger(seed) && seed >= 0 && seed <= 2_000_000_000).toBe(true);
      expect(url.searchParams.get('map')).toBe('gen');
      seeds.add(seed);
    }
    expect(seeds.size).toBeGreaterThan(1);
  });

  it.each([12, 30, 60])(
    'loadMapJson строит карту на %i стартовых точек, и она проходит loadMap',
    async (size) => {
      const json = await loadMapJson({ id: 'gen', seed: 777, players: 2, size });
      const loaded = loadMap(json);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.map.spawns).toHaveLength(size);
    },
    30_000,
  );

  it('разные зёрна дают разные карты, одно зерно — одну', async () => {
    const request = { id: 'gen', players: 2, size: 12 } as const;
    const a = JSON.stringify(await loadMapJson({ ...request, seed: 1 }));
    const b = JSON.stringify(await loadMapJson({ ...request, seed: 2 }));
    const again = JSON.stringify(await loadMapJson({ ...request, seed: 1 }));
    expect(a).not.toBe(b);
    expect(a).toBe(again);
  });
});
