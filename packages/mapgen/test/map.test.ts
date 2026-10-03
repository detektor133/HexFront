import { describe, expect, it } from 'vitest';

import {
  CITY_MIN_DISTANCE,
  TERRAIN,
  decodeBase64,
  distance,
  hexId,
  inBounds,
  loadMap,
  spiral,
} from '@hexfront/sim';

import { generateMap } from '../src/index.ts';

describe('города и стартовые позиции', () => {
  it('принимает от 2 до 30 игроков и выдаёт столько же спавнов', () => {
    for (let players = 2; players <= 30; players += 1) {
      const map = generateMap(42, { width: 80, height: 60, players });
      expect(map.spawns).toHaveLength(players);
      expect(loadMap(map).ok).toBe(true);
    }
  }, 15_000);

  it('размещает спавны на равнине или в лесу с расстоянием не менее 10', () => {
    const map = generateMap(42, { width: 80, height: 60, players: 30 });
    const terrain = decodeBase64(map.terrain);
    expect(terrain).not.toBeNull();
    for (const spawn of map.spawns) {
      const code = terrain?.[hexId(spawn, map.width)];
      expect([TERRAIN.plains, TERRAIN.forest]).toContain(code);
      const passable = spiral(spawn, 2).filter((hex) => {
        const id = hexId(hex, map.width);
        return inBounds(hex, map.width, map.height) && terrain?.[id] !== TERRAIN.water;
      });
      expect(passable.length).toBeGreaterThanOrEqual(15);
    }
    for (let i = 0; i < map.spawns.length; i += 1) {
      const spawn = map.spawns[i];
      if (!spawn) continue;
      for (const other of map.spawns.slice(i + 1))
        expect(distance(spawn, other)).toBeGreaterThanOrEqual(10);
    }
  });

  it('соблюдает минимальную дистанцию между городами', () => {
    const map = generateMap(42, { width: 80, height: 60, players: 30 });
    expect(map.cities.length).toBe(45);
    for (let i = 0; i < map.cities.length; i += 1) {
      const city = map.cities[i];
      if (!city) continue;
      for (const other of map.cities.slice(i + 1))
        expect(distance(city, other)).toBeGreaterThanOrEqual(CITY_MIN_DISTANCE);
    }
  });
});
