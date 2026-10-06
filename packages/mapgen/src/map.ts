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

import { MAPGEN_MAX_PLAYERS, PASSABLE_HEXES_PER_PLAYER, MAPGEN_WATER_SHARE } from './params.ts';
import { generateRoads } from './roads.ts';
import { generateTerrain, type MapOptions } from './terrain.ts';

type MapInputOptions = Omit<MapOptions, 'width' | 'height'> &
  Partial<Pick<MapOptions, 'width' | 'height'>>;

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

function mapDimensions(players: number): { width: number; height: number } {
  const area = Math.ceil((players * PASSABLE_HEXES_PER_PLAYER * 100) / (100 - MAPGEN_WATER_SHARE));
  const width = Math.ceil(Math.sqrt((area * 4) / 3));
  return { width, height: Math.ceil(area / width) };
}

function resolveOptions(options: MapInputOptions): MapOptions {
  const dimensions = mapDimensions(options.players);
  return {
    players: options.players,
    width: options.width ?? dimensions.width,
    height: options.height ?? dimensions.height,
  };
}

function validateOptions(options: Required<MapOptions>): void {
  if (
    !Number.isInteger(options.players) ||
    options.players < 2 ||
    options.players > MAPGEN_MAX_PLAYERS ||
    !Number.isInteger(options.width) ||
    !Number.isInteger(options.height) ||
    options.width <= 0 ||
    options.height <= 0
  ) {
    throw new RangeError('генератор карты: ожидается 2–100 игроков и положительный размер карты');
  }
}

function passableCount(center: Hex, terrain: Uint8Array, options: MapOptions): number {
  return spiral(center, 2).filter((hex) => {
    if (!inBounds(hex, options.width, options.height)) return false;
    return terrain[hexId(hex, options.width)] !== TERRAIN.water;
  }).length;
}

function largestRoadableLand(
  terrain: Uint8Array,
  features: Uint8Array,
  options: MapOptions,
): Set<number> {
  const checked = new Set<number>();
  let largest: number[] = [];
  for (let start = 0; start < terrain.length; start += 1) {
    if (
      terrain[start] === TERRAIN.water ||
      (terrain[start] === TERRAIN.mountains && features[start] !== FEATURE.pass) ||
      checked.has(start)
    )
      continue;
    const component: number[] = [start];
    checked.add(start);
    for (let i = 0; i < component.length; i += 1) {
      const id = component[i];
      if (id === undefined) continue;
      for (const hex of neighbors(hexFromId(id, options.width))) {
        if (!inBounds(hex, options.width, options.height)) continue;
        const next = hexId(hex, options.width);
        if (
          terrain[next] !== TERRAIN.water &&
          (terrain[next] !== TERRAIN.mountains || features[next] === FEATURE.pass) &&
          !checked.has(next)
        ) {
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

export function generateMap(seed: number, options: MapInputOptions): MapJson {
  const resolvedOptions = resolveOptions(options);
  validateOptions(resolvedOptions);
  const result = generateTerrain(seed, resolvedOptions);
  const terrain = result.terrain;
  const features = result.features.slice();
  const land = largestRoadableLand(terrain, features, resolvedOptions);
  const spawns = chooseSpawns(seed, terrain, land, resolvedOptions);
  clearSpawnFeatures(features, spawns, resolvedOptions);
  const cities = chooseCities(seed, terrain, features, spawns, land, resolvedOptions);
  const nodes = [...cities, ...spawns];
  const roads = generateRoads(terrain, features, nodes, resolvedOptions);
  return {
    version: 1,
    id: `proc-${(seed >>> 0).toString(16)}`,
    width: resolvedOptions.width,
    height: resolvedOptions.height,
    terrain: encodeBase64(terrain),
    features: Array.from(features).flatMap((feature, id) => {
      if (feature === FEATURE.none) return [];
      const hex = hexFromId(id, resolvedOptions.width);
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
