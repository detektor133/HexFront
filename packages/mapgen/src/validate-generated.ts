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

function reachableSpawns(
  map: MapJson,
  terrain: Uint8Array,
  start: MapJson['spawns'][number],
): number {
  const startId = hexId(start, map.width);
  const visited = new Set<number>([startId]);
  const queue: number[] = [startId];
  const spawnIds = new Set(map.spawns.map((spawn) => hexId(spawn, map.width)));
  let reached = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    if (id === undefined) continue;
    if (spawnIds.has(id) && id !== startId) reached += 1;
    for (const next of neighbors(hexFromId(id, map.width))) {
      if (!inBounds(next, map.width, map.height)) continue;
      const nextId = hexId(next, map.width);
      if (terrain[nextId] === TERRAIN.water || visited.has(nextId)) continue;
      visited.add(nextId);
      queue.push(nextId);
    }
  }
  return reached;
}

export function validateGeneratedMap(seed: number, options: MapOptions): readonly string[] {
  const json = generateMap(seed, options);
  const loaded = loadMap(json);
  if (!loaded.ok) return loaded.errors;
  const terrain = decodeBase64(json.terrain);
  if (!terrain) return ['terrain: генератор вернул некорректный base64'];
  const errors: string[] = [];
  for (const [index, spawn] of json.spawns.entries()) {
    if (passableAround(json, terrain, spawn) < 15)
      errors.push(`спавн #${index}: менее 15 гексов в радиусе 2`);
    if (reachableSpawns(json, terrain, spawn) < 2)
      errors.push(`спавн #${index}: нет двух соседних спавнов по суше`);
  }
  return errors;
}
