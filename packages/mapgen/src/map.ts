import {
  FEATURE,
  TERRAIN,
  distance,
  encodeBase64,
  fork,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  packBits,
  shuffle,
  spiral,
  type MapJson,
  type Hex,
} from '@hexfront/sim';

import { generateRoads } from './roads.ts';
import { generateTerrain, type TerrainOptions } from './terrain.ts';

export type MapOptions = TerrainOptions;

const CITY_NAMES: readonly string[] = [
  'Вельск',
  'Ольховка',
  'Сосногорск',
  'Каменка',
  'Липецово',
  'Дубрава',
  'Заречье',
  'Береговое',
  'Ясногорье',
  'Речицы',
  'Северный',
  'Озерки',
  'Горелово',
  'Луговск',
  'Прибрежный',
] as const;

const cityName = (id: number): string => {
  const base = CITY_NAMES[(id - 1) % CITY_NAMES.length] ?? 'Посад';
  const cycle = Math.floor((id - 1) / CITY_NAMES.length);
  return cycle === 0 ? base : `${base}-${cycle + 1}`;
};

function validateOptions(options: MapOptions): void {
  if (
    !Number.isInteger(options.players) ||
    options.players < 2 ||
    options.players > 30 ||
    !Number.isInteger(options.width) ||
    !Number.isInteger(options.height) ||
    options.width <= 0 ||
    options.height <= 0
  ) {
    throw new RangeError('генератор карты: ожидается 2–30 игроков и положительный размер карты');
  }
}

function passableCount(center: Hex, terrain: Uint8Array, options: MapOptions): number {
  return spiral(center, 2).filter((hex) => {
    if (!inBounds(hex, options.width, options.height)) return false;
    return terrain[hexId(hex, options.width)] !== TERRAIN.water;
  }).length;
}

function largestLand(terrain: Uint8Array, options: MapOptions): Set<number> {
  const checked = new Set<number>();
  let largest: number[] = [];
  for (let start = 0; start < terrain.length; start += 1) {
    if (terrain[start] === TERRAIN.water || checked.has(start)) continue;
    const component: number[] = [start];
    checked.add(start);
    for (let i = 0; i < component.length; i += 1) {
      const id = component[i];
      if (id === undefined) continue;
      for (const hex of neighbors(hexFromId(id, options.width))) {
        if (!inBounds(hex, options.width, options.height)) continue;
        const next = hexId(hex, options.width);
        if (terrain[next] !== TERRAIN.water && !checked.has(next)) {
          checked.add(next);
          component.push(next);
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  return new Set(largest);
}

function chooseSpawns(
  seed: number,
  terrain: Uint8Array,
  land: ReadonlySet<number>,
  options: MapOptions,
): Hex[] {
  const candidates = shuffle(
    fork(seed, 401),
    Array.from({ length: terrain.length }, (_, id) => id),
  )
    .map((id) => hexFromId(id, options.width))
    .filter((hex) => {
      if (!land.has(hexId(hex, options.width))) return false;
      const code = terrain[hexId(hex, options.width)];
      return (
        (code === TERRAIN.plains || code === TERRAIN.forest) &&
        passableCount(hex, terrain, options) >= 15
      );
    });
  const spawns: Hex[] = [];
  for (const candidate of candidates) {
    if (spawns.every((spawn) => distance(spawn, candidate) >= 10)) spawns.push(candidate);
    if (spawns.length === options.players) return spawns;
  }
  throw new Error(`генератор карты: не удалось разместить ${options.players} спавнов`);
}

function clearSpawnFeatures(
  features: Uint8Array,
  spawns: readonly Hex[],
  options: MapOptions,
): void {
  for (const spawn of spawns) {
    for (const hex of spiral(spawn, 2)) {
      if (inBounds(hex, options.width, options.height))
        features[hexId(hex, options.width)] = FEATURE.none;
    }
  }
}

function chooseCities(
  seed: number,
  terrain: Uint8Array,
  features: Uint8Array,
  spawns: readonly Hex[],
  land: ReadonlySet<number>,
  options: MapOptions,
): MapJson['cities'] {
  const target = Math.floor((options.players * 3 + 1) / 2);
  const candidates = shuffle(
    fork(seed, 402),
    Array.from({ length: terrain.length }, (_, id) => id),
  )
    .map((id) => hexFromId(id, options.width))
    .filter((hex) => {
      const id = hexId(hex, options.width);
      if (!land.has(id)) return false;
      return (
        terrain[id] !== TERRAIN.water &&
        terrain[id] !== TERRAIN.mountains &&
        features[id] === FEATURE.none
      );
    });
  const cities: MapJson['cities'] = [];
  for (const candidate of candidates) {
    if (spawns.some((spawn) => distance(spawn, candidate) < 4)) continue;
    if (cities.some((city) => distance(city, candidate) < 4)) continue;
    const id = cities.length + 1;
    const level = (id % 3) + 1;
    cities.push({
      id,
      q: candidate.q,
      r: candidate.r,
      name: cityName(id),
      level,
      garrison: [150, 300, 600][level - 1] ?? 150,
    });
    if (cities.length === target) return cities;
  }
  throw new Error(`генератор карты: не удалось разместить ${target} городов`);
}

export function generateMap(seed: number, options: MapOptions): MapJson {
  validateOptions(options);
  const result = generateTerrain(seed, options);
  const terrain = result.terrain;
  const features = result.features.slice();
  const land = largestLand(terrain, options);
  const spawns = chooseSpawns(seed, terrain, land, options);
  clearSpawnFeatures(features, spawns, options);
  const cities = chooseCities(seed, terrain, features, spawns, land, options);
  const nodes = [...cities, ...spawns];
  const roads = generateRoads(terrain, features, nodes, options);
  return {
    version: 1,
    id: `proc-${(seed >>> 0).toString(16)}`,
    width: options.width,
    height: options.height,
    terrain: encodeBase64(terrain),
    features: Array.from(features).flatMap((feature, id) => {
      if (feature === FEATURE.none) return [];
      const hex = hexFromId(id, options.width);
      const type =
        feature === FEATURE.fertile ? 'fertile' : feature === FEATURE.mine ? 'mine' : 'pass';
      return [{ q: hex.q, r: hex.r, type }];
    }),
    riverEdges: result.riverEdges.map(([q, r, dir]) => [q, r, dir]),
    roads: encodeBase64(packBits(roads)),
    cities,
    spawns,
  };
}
