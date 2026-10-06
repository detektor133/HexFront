import { describe, expect, it } from 'vitest';

import {
  CITY_MIN_DISTANCE,
  FEATURE,
  TERRAIN,
  decodeBase64,
  distance,
  hexFromId,
  hexId,
  inBounds,
  loadMap,
  neighbors,
  unpackBits,
  spiral,
} from '@hexfront/sim';

import { generateMap } from '../src/index.ts';

describe('города и стартовые позиции', () => {
  it('масштабирует карту для 50 и 100 игроков на нескольких сидах', () => {
    for (const players of [50, 100]) {
      for (const seed of [0, 42, 99]) {
        const map = generateMap(seed, { players });
        expect(map.spawns).toHaveLength(players);
        const terrain = decodeBase64(map.terrain);
        expect(terrain?.filter((code) => code !== TERRAIN.water).length).toBeGreaterThanOrEqual(
          players * 120,
        );
        const loaded = loadMap(map);
        expect(
          loaded.ok,
          `${players} игроков, сид ${seed}: ${loaded.ok ? '' : loaded.errors.join('; ')}`,
        ).toBe(true);
      }
    }
  }, 120_000);

  it('отклоняет больше 100 игроков', () => {
    expect(() => generateMap(42, { players: 101 })).toThrow('2–100 игроков');
  });

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

  it('соединяет города и спавны дорогами без воды и непроходимых гор', () => {
    const map = generateMap(42, { width: 80, height: 60, players: 30 });
    const terrain = decodeBase64(map.terrain);
    const roads = decodeBase64(map.roads);
    const loaded = loadMap(map);
    expect(terrain).not.toBeNull();
    expect(roads).not.toBeNull();
    const road = roads ? unpackBits(roads, map.width * map.height) : new Uint8Array();
    for (let id = 0; id < road.length; id += 1) {
      if (road[id] !== 1) continue;
      expect(terrain?.[id]).not.toBe(TERRAIN.water);
      if (terrain?.[id] === TERRAIN.mountains && loaded.ok)
        expect(loaded.map.features[id]).toBe(FEATURE.pass);
    }
    const nodes = [...map.cities, ...map.spawns];
    const connected = new Set<number>();
    const first = nodes[0];
    if (first) connected.add(hexId(first, map.width));
    for (let cursor = 0; cursor < connected.size; cursor += 1) {
      const id = [...connected][cursor];
      if (id === undefined) continue;
      for (const next of neighbors(hexFromId(id, map.width))) {
        if (!inBounds(next, map.width, map.height)) continue;
        const nextId = hexId(next, map.width);
        if (road[id] === 1 && road[nextId] === 1) connected.add(nextId);
      }
    }
    expect(nodes.every((node) => connected.has(hexId(node, map.width)))).toBe(true);
  });
});
