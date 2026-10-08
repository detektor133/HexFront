import {
  TERRAIN,
  decodeBase64,
  hexFromId,
  hexId,
  inBounds,
  loadMap,
  neighbors,
  spiral,
  type MapJson,
} from '@hexfront/sim';

import { generateMap } from './map.ts';
import type { MapOptions } from './terrain.ts';

function passableAround(
  map: MapJson,
  terrain: Uint8Array,
  spawn: MapJson['spawns'][number],
): number {
  return spiral(spawn, 2).filter((hex) => {
    if (!inBounds(hex, map.width, map.height)) return false;
    return terrain[hexId(hex, map.width)] !== TERRAIN.water;
  }).length;
}

function reachableSpawnCounts(map: MapJson, terrain: Uint8Array): Int32Array {
  const componentByHex = new Int32Array(terrain.length).fill(-1);
  const spawnIds = new Set(map.spawns.map((spawn) => hexId(spawn, map.width)));
  const componentSpawnCounts: number[] = [];
  for (let startId = 0; startId < terrain.length; startId += 1) {
    if (terrain[startId] === TERRAIN.water || componentByHex[startId] !== -1) continue;
    const component = componentSpawnCounts.length;
    const queue: number[] = [startId];
    componentByHex[startId] = component;
    let spawnCount = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor];
      if (id === undefined) continue;
      if (spawnIds.has(id)) spawnCount += 1;
      for (const next of neighbors(hexFromId(id, map.width))) {
        if (!inBounds(next, map.width, map.height)) continue;
        const nextId = hexId(next, map.width);
        if (terrain[nextId] === TERRAIN.water || componentByHex[nextId] !== -1) continue;
        componentByHex[nextId] = component;
        queue.push(nextId);
      }
    }
    componentSpawnCounts.push(spawnCount);
  }
  return new Int32Array(
    map.spawns.map((spawn) => {
      const component = componentByHex[hexId(spawn, map.width)] ?? -1;
      return component >= 0 ? (componentSpawnCounts[component] ?? 0) - 1 : 0;
    }),
  );
}

export function validateGeneratedMap(seed: number, options: MapOptions): readonly string[] {
  const json = generateMap(seed, options);
  const loaded = loadMap(json);
  if (!loaded.ok) return loaded.errors;
  const terrain = decodeBase64(json.terrain);
  if (!terrain) return ['terrain: генератор вернул некорректный base64'];
  const errors: string[] = [];
  const reachable = reachableSpawnCounts(json, terrain);
  for (const [index, spawn] of json.spawns.entries()) {
    if (passableAround(json, terrain, spawn) < 15)
      errors.push(`спавн #${index}: менее 15 гексов в радиусе 2`);
    if ((reachable[index] ?? 0) < 2)
      errors.push(`спавн #${index}: нет двух соседних спавнов по суше`);
  }
  return errors;
}
