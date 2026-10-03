import {
  FEATURE,
  TERRAIN,
  distance,
  fork,
  hexFromId,
  hexId,
  inBounds,
  neighbor,
  nextU32,
  shuffle,
  type Direction,
  type Hex,
} from '@hexfront/sim';

import {
  MAPGEN_DESERT_SHARE,
  MAPGEN_EDGE_WATER,
  MAPGEN_FERTILE_PER_PLAYER_DENOMINATOR,
  MAPGEN_FERTILE_PER_PLAYER_NUMERATOR,
  MAPGEN_FOREST_SHARE,
  MAPGEN_HILLS_SHARE,
  MAPGEN_MINE_PER_PLAYER_DENOMINATOR,
  MAPGEN_MINE_PER_PLAYER_NUMERATOR,
  MAPGEN_MIN_ISLAND,
  MAPGEN_MOUNTAIN_SHARE,
  MAPGEN_NOISE_OCTAVES,
  MAPGEN_PASS_PER_MOUNTAINS,
  MAPGEN_RIVER_MAX_EDGES,
  MAPGEN_RIVER_MIN_EDGES,
  MAPGEN_RIVERS_PER_PLAYER_DENOMINATOR,
  MAPGEN_RIVERS_PER_PLAYER_NUMERATOR,
  MAPGEN_WATER_SHARE,
} from './params.ts';

export interface TerrainOptions {
  readonly width: number;
  readonly height: number;
  readonly players: number;
}

export interface TerrainResult {
  readonly terrain: Uint8Array;
  readonly features: Uint8Array;
  readonly riverEdges: readonly [number, number, number][];
}

const OCTAVE_SCALE = [8, 4, 2] as const;
const OPPOSITE: readonly Direction[] = [3, 4, 5, 0, 1, 2];

function ceilRatio(value: number, numerator: number, denominator: number): number {
  return Math.floor((value * numerator + denominator - 1) / denominator);
}

function latticeValue(seed: number, q: number, r: number): number {
  let value = Math.imul(q, 0x45d9f3b) ^ Math.imul(r, 0x119de1f3) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) % 1001;
}

function noiseValue(seeds: readonly number[], h: Hex): number {
  let result = 0;
  let weight = 1;
  let total = 0;
  for (let octave = 0; octave < MAPGEN_NOISE_OCTAVES; octave += 1) {
    const scale = OCTAVE_SCALE[octave] ?? 2;
    const q0 = Math.floor(h.q / scale);
    const r0 = Math.floor(h.r / scale);
    const x = ((h.q % scale) + scale) % scale;
    const y = ((h.r % scale) + scale) % scale;
    const octaveSeed = seeds[octave] ?? 0;
    const a = latticeValue(octaveSeed, q0, r0);
    const b = latticeValue(octaveSeed, q0 + 1, r0);
    const c = latticeValue(octaveSeed, q0, r0 + 1);
    const d = latticeValue(octaveSeed, q0 + 1, r0 + 1);
    const top = a + Math.floor(((b - a) * x) / scale);
    const bottom = c + Math.floor(((d - c) * x) / scale);
    result += (top + Math.floor(((bottom - top) * y) / scale)) * weight;
    total += 1000 * weight;
    weight *= 2;
  }
  return Math.max(0, Math.min(1000, Math.floor((result * 1000) / total)));
}

function humidityValue(seeds: readonly number[], h: Hex): number {
  return noiseValue(seeds, { q: h.q * 2, r: h.r * 2 });
}

function edgeDistance(h: Hex, width: number, height: number): number {
  const col = h.q;
  const row = h.r + Math.floor((h.q + (h.q & 1)) / 2);
  return Math.min(col, row, width - 1 - col, height - 1 - row);
}

function sortedIds(ids: number[], values: readonly number[]): number[] {
  return ids.sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0) || a - b);
}

function terrainFor(
  seed: number,
  options: TerrainOptions,
): { terrain: Uint8Array; heights: number[]; humidity: number[] } {
  const size = options.width * options.height;
  const heights: number[] = [];
  const humidity: number[] = [];
  const heightSeeds = [101, 102, 103].map((stream) => nextU32(fork(seed, stream)));
  const humiditySeeds = [201, 202, 203].map((stream) => nextU32(fork(seed ^ 0x51ed270b, stream)));
  for (let id = 0; id < size; id += 1) {
    const h = hexFromId(id, options.width);
    const edge = Math.max(0, MAPGEN_EDGE_WATER - edgeDistance(h, options.width, options.height));
    heights.push(Math.max(0, noiseValue(heightSeeds, h) - edge * 180));
    humidity.push(humidityValue(humiditySeeds, h));
  }
  const terrain = new Uint8Array(size).fill(TERRAIN.plains);
  const ids = Array.from({ length: size }, (_, id) => id);
  const waterCount = Math.floor((size * MAPGEN_WATER_SHARE + 50) / 100);
  const water = sortedIds(ids, heights).slice(0, waterCount);
  water.forEach((id) => {
    terrain[id] = TERRAIN.water;
  });
  const checked = new Set<number>();
  for (const start of ids) {
    if (terrain[start] === TERRAIN.water || checked.has(start)) continue;
    const island: number[] = [start];
    checked.add(start);
    for (let i = 0; i < island.length; i += 1) {
      const current = island[i];
      if (current === undefined) continue;
      const h = hexFromId(current, options.width);
      for (let dir = 0; dir < 6; dir += 1) {
        const next = neighbor(h, dir as Direction);
        if (!inBounds(next, options.width, options.height)) continue;
        const nextId = hexId(next, options.width);
        if (terrain[nextId] !== TERRAIN.water && !checked.has(nextId)) {
          checked.add(nextId);
          island.push(nextId);
        }
      }
    }
    if (island.length < MAPGEN_MIN_ISLAND)
      island.forEach((id) => {
        terrain[id] = TERRAIN.water;
      });
  }
  const currentWater = ids.filter((id) => terrain[id] === TERRAIN.water);
  if (currentWater.length > waterCount) {
    sortedIds(currentWater, heights)
      .slice(0, currentWater.length - waterCount)
      .forEach((id) => {
        terrain[id] = TERRAIN.plains;
      });
  }
  const land = ids.filter((id) => terrain[id] !== TERRAIN.water);
  const high = sortedIds([...land], heights).reverse();
  const mountainCount = Math.floor((land.length * MAPGEN_MOUNTAIN_SHARE + 50) / 100);
  const hillCount = Math.floor((land.length * MAPGEN_HILLS_SHARE + 50) / 100);
  high.slice(0, mountainCount).forEach((id) => {
    terrain[id] = TERRAIN.mountains;
  });
  high.slice(mountainCount, mountainCount + hillCount).forEach((id) => {
    terrain[id] = TERRAIN.hills;
  });
  const lowHumidity = sortedIds(
    land.filter((id) => terrain[id] === TERRAIN.plains),
    humidity,
  );
  const desertCount = Math.floor((lowHumidity.length * MAPGEN_DESERT_SHARE + 50) / 100);
  const forestCount = Math.floor((lowHumidity.length * MAPGEN_FOREST_SHARE + 50) / 100);
  lowHumidity.slice(0, desertCount).forEach((id) => {
    terrain[id] = TERRAIN.desert;
  });
  lowHumidity.slice(-forestCount).forEach((id) => {
    terrain[id] = TERRAIN.forest;
  });
  return { terrain, heights, humidity };
}

function placeFeatures(seed: number, terrain: Uint8Array, options: TerrainOptions): Uint8Array {
  const features = new Uint8Array(terrain.length);
  const rng = fork(seed, 202);
  const order = shuffle(
    rng,
    Array.from({ length: terrain.length }, (_, id) => id),
  );
  const placed: number[] = [];
  const place = (code: number, candidates: number[], target: number): void => {
    for (const id of candidates) {
      if (
        placed.some(
          (other) => distance(hexFromId(other, options.width), hexFromId(id, options.width)) < 3,
        )
      )
        continue;
      features[id] = code;
      placed.push(id);
      if (placed.filter((value) => features[value] === code).length >= target) return;
    }
  };
  place(
    FEATURE.fertile,
    order.filter((id) => terrain[id] === TERRAIN.plains),
    ceilRatio(
      options.players,
      MAPGEN_FERTILE_PER_PLAYER_NUMERATOR,
      MAPGEN_FERTILE_PER_PLAYER_DENOMINATOR,
    ),
  );
  place(
    FEATURE.mine,
    order.filter((id) => terrain[id] === TERRAIN.hills),
    ceilRatio(
      options.players,
      MAPGEN_MINE_PER_PLAYER_NUMERATOR,
      MAPGEN_MINE_PER_PLAYER_DENOMINATOR,
    ),
  );
  const mountainIds = order.filter((id) => terrain[id] === TERRAIN.mountains);
  place(
    FEATURE.pass,
    mountainIds.filter((id) => {
      const h = hexFromId(id, options.width);
      return [0, 1, 2].some((dir) => {
        const a = neighbor(h, dir as Direction);
        const b = neighbor(h, OPPOSITE[dir] as Direction);
        return (
          inBounds(a, options.width, options.height) &&
          inBounds(b, options.width, options.height) &&
          terrain[hexId(a, options.width)] !== TERRAIN.water &&
          terrain[hexId(a, options.width)] !== TERRAIN.mountains &&
          terrain[hexId(b, options.width)] !== TERRAIN.water &&
          terrain[hexId(b, options.width)] !== TERRAIN.mountains
        );
      });
    }),
    Math.max(1, Math.floor(mountainIds.length / MAPGEN_PASS_PER_MOUNTAINS)),
  );
  return features;
}

function riverEdges(
  seed: number,
  terrain: Uint8Array,
  heights: readonly number[],
  options: TerrainOptions,
): [number, number, number][] {
  const target = ceilRatio(
    options.players,
    MAPGEN_RIVERS_PER_PLAYER_NUMERATOR,
    MAPGEN_RIVERS_PER_PLAYER_DENOMINATOR,
  );
  const sources = shuffle(
    fork(seed, 303),
    Array.from({ length: terrain.length }, (_, id) => id),
  ).filter((id) => terrain[id] === TERRAIN.hills || terrain[id] === TERRAIN.mountains);
  const result: [number, number, number][] = [];
  const used = new Set<string>();
  for (const sourceId of sources.slice(0, target * 4)) {
    const path: Hex[] = [hexFromId(sourceId, options.width)];
    const seen = new Set<number>([sourceId]);
    for (let step = 0; step < MAPGEN_RIVER_MAX_EDGES; step += 1) {
      const current = path[path.length - 1];
      if (!current) break;
      const candidates = [0, 1, 2, 3, 4, 5]
        .map((dir) => ({ dir: dir as Direction, hex: neighbor(current, dir as Direction) }))
        .filter((candidate) => inBounds(candidate.hex, options.width, options.height))
        .sort(
          (a, b) =>
            (heights[hexId(a.hex, options.width)] ?? 0) -
              (heights[hexId(b.hex, options.width)] ?? 0) || a.dir - b.dir,
        );
      const next = candidates.find((candidate) => !seen.has(hexId(candidate.hex, options.width)));
      if (!next) break;
      path.push(next.hex);
      seen.add(hexId(next.hex, options.width));
      if (terrain[hexId(next.hex, options.width)] === TERRAIN.water) break;
    }
    const last = path[path.length - 1];
    if (
      !last ||
      path.length - 1 < MAPGEN_RIVER_MIN_EDGES ||
      terrain[hexId(last, options.width)] !== TERRAIN.water
    )
      continue;
    for (let i = 1; i < path.length; i += 1) {
      const from = path[i - 1];
      const to = path[i];
      if (!from || !to) continue;
      const dir =
        [0, 1, 2, 3, 4, 5].find((candidate) => {
          const n = neighbor(from, candidate as Direction);
          return n.q === to.q && n.r === to.r;
        }) ?? 0;
      const start = dir < 3 ? from : to;
      const canonical = dir < 3 ? dir : dir - 3;
      const key = `${start.q},${start.r},${canonical}`;
      if (!used.has(key)) {
        used.add(key);
        result.push([start.q, start.r, canonical]);
      }
    }
    if (result.length >= target * MAPGEN_RIVER_MIN_EDGES) break;
  }
  return result;
}

export function generateTerrain(seed: number, options: TerrainOptions): TerrainResult {
  if (
    !Number.isSafeInteger(seed) ||
    options.width <= 0 ||
    options.height <= 0 ||
    options.players <= 0
  ) {
    throw new RangeError('генератор рельефа: некорректные параметры');
  }
  const generated = terrainFor(seed, options);
  return {
    terrain: generated.terrain,
    features: placeFeatures(seed, generated.terrain, options),
    riverEdges: riverEdges(seed, generated.terrain, generated.heights, options),
  };
}
