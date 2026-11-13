import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { distance, hexFromId, hexId, loadMap, neighbors, TERRAIN } from '@hexfront/sim';

import { largestRoadableLand } from '../src/map.ts';

/** Готовые карты меню: id → число спавнов (максимум игроков). */
const MAPS = {
  europe: 30,
  mediterranean: 16,
  north: 14,
  namerica: 16,
  japan: 8,
  mideast: 14,
  continent: 24,
  archipelago: 18,
  small: 6,
  tiny: 2,
} as const;

function read(id: string): unknown {
  return JSON.parse(readFileSync(new URL(`../maps/${id}.json`, import.meta.url), 'utf8'));
}

describe('готовые карты меню', () => {
  for (const [id, spawns] of Object.entries(MAPS)) {
    it(`${id}: валидна, ${spawns} спавнов на одной суше, города на суше`, () => {
      const loaded = loadMap(read(id));
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const map = loaded.map;
      expect(map.spawns).toHaveLength(spawns);
      const land = largestRoadableLand(map.terrain, map.features, {
        width: map.width,
        height: map.height,
        players: spawns,
      });
      for (const spawn of map.spawns) {
        expect(map.terrain[hexId(spawn, map.width)]).not.toBe(TERRAIN.water);
        expect(land.has(hexId(spawn, map.width))).toBe(true);
        const free = [spawn, ...neighbors(spawn)].filter((hex) => land.has(hexId(hex, map.width)));
        expect(free.length).toBeGreaterThanOrEqual(2);
      }
      for (const city of map.cities) {
        expect(map.terrain[hexId(city, map.width)]).not.toBe(TERRAIN.water);
        expect(land.has(hexId(city, map.width))).toBe(true);
      }
      for (let a = 0; a < map.spawns.length; a += 1)
        for (let b = a + 1; b < map.spawns.length; b += 1) {
          const left = map.spawns[a];
          const right = map.spawns[b];
          if (left && right)
            expect(distance(left, right)).toBeGreaterThanOrEqual(id === 'tiny' ? 1 : 5);
        }
    });
  }

  it('реки не лежат на воде', () => {
    for (const id of ['europe', 'north', 'namerica', 'japan']) {
      const loaded = loadMap(read(id));
      if (!loaded.ok) throw new Error(id);
      const { terrain, width, height } = loaded.map;
      for (let i = 0; i < terrain.length; i += 1) {
        if (terrain[i] !== TERRAIN.water) continue;
        expect(loaded.map.rivers[i]).toBe(0);
        void hexFromId(i, width);
        void height;
      }
    }
  });
});
