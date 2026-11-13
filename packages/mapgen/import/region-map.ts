// Растеризация слоёв Natural Earth в карту формата v1: рельеф, проливы и мосты, реки, спавны, города.
import {
  FEATURE,
  TERRAIN,
  distance,
  encodeBase64,
  hexFromId,
  hexId,
  inBounds,
  line,
  neighbor,
  neighbors,
  packBits,
  decodeBase64,
  type Direction,
  type Hex,
  type MapJson,
} from '@hexfront/sim';

import { Mask, hexPoint, hexRadius, pointHex, unionMask, type Grid } from './raster.ts';
import type { LatLon, Region } from './regions.ts';
import { project, type Center, type Point, type Shape } from './shapefile.ts';
import { CITY_NAMES, chooseCities, largestRoadableLand } from '../src/map.ts';
import { riverFromHexPath } from '../src/rivers.ts';
import { generateRoads } from '../src/roads.ts';

/** Слои Natural Earth в проекции региона. */
export interface Layers {
  readonly land: readonly Shape[];
  readonly lakes: readonly Shape[];
  readonly rivers: readonly Shape[];
  readonly mountains: readonly Shape[];
  readonly deserts: readonly Shape[];
}

/** Зазор между спавнами не меньше этого числа гексов. */
const MIN_SPAWN_GAP = 7;
const SAMPLE_REACH = 0.55;

// Детерминированный шум 0–99 по клетке: лес и холмы пятнами, а не полосами проекции.
function noise(col: number, row: number): number {
  let h = Math.imul(col, 374761393) + Math.imul(row, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) % 100;
}

interface Masks {
  land: Mask;
  lakes: Mask;
  mountains: { contains(p: Point): boolean };
  deserts: { contains(p: Point): boolean };
}

function rasterTerrain(grid: Grid, layers: Layers): Uint8Array {
  const { min, max } = grid;
  const masks: Masks = {
    land: new Mask(layers.land, min, max),
    lakes: new Mask(layers.lakes, min, max),
    mountains: unionMask(layers.mountains, min, max),
    deserts: unionMask(layers.deserts, min, max),
  };
  const reach = hexRadius(grid) * SAMPLE_REACH;
  const terrain = new Uint8Array(grid.width * grid.height);
  for (let id = 0; id < terrain.length; id += 1) {
    const col = id % grid.width;
    const row = Math.floor(id / grid.width);
    const center = hexPoint(grid, col, row);
    // Гекс — суша, если большинство из семи проб (центр и шесть по кругу) на суше: узкие заливы
    // и косы не исчезают и не раздуваются.
    let landSamples = 0;
    for (let k = -1; k < 6; k += 1) {
      const angle = (k * Math.PI) / 3;
      const point =
        k < 0
          ? center
          : { x: center.x + reach * Math.cos(angle), y: center.y + reach * Math.sin(angle) };
      if (masks.land.contains(point) && !masks.lakes.contains(point)) landSamples += 1;
    }
    if (landSamples < 4) continue;
    if (masks.mountains.contains(center)) {
      terrain[id] = noise(col, row) % 3 === 0 ? TERRAIN.hills : TERRAIN.mountains;
    } else if (masks.deserts.contains(center)) {
      terrain[id] = TERRAIN.desert;
    } else {
      const value = noise(Math.floor(col / 3), Math.floor(row / 3));
      terrain[id] = value > 62 ? TERRAIN.forest : value % 9 === 0 ? TERRAIN.hills : TERRAIN.plains;
    }
  }
  return terrain;
}

function hexOfLatLon(grid: Grid, center: Center, at: LatLon): Hex {
  return pointHex(grid, project(at[1], at[0], center));
}

// Ломаная правок → цепочка гексов (между вершинами — линия по сетке).
function polylineHexes(grid: Grid, center: Center, points: readonly LatLon[]): Hex[] {
  const out: Hex[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = hexOfLatLon(grid, center, points[i - 1] as LatLon);
    const b = hexOfLatLon(grid, center, points[i] as LatLon);
    out.push(...line(a, b));
  }
  return out;
}

function applyEdits(terrain: Uint8Array, grid: Grid, center: Center, region: Region): void {
  const place = (lines: readonly (readonly LatLon[])[], code: number): void => {
    for (const points of lines)
      for (const hex of polylineHexes(grid, center, points)) {
        if (!inBounds(hex, grid.width, grid.height)) continue;
        const id = hexId(hex, grid.width);
        if (code === TERRAIN.plains && terrain[id] !== TERRAIN.water) continue;
        terrain[id] = code;
      }
  };
  place(region.strait, TERRAIN.water);
  place(region.link, TERRAIN.plains);
}

// Хребты: холмы вокруг гор и редкие перевалы.
function softenMountains(terrain: Uint8Array, features: Uint8Array, grid: Grid): void {
  for (let id = 0; id < terrain.length; id += 1) {
    if (terrain[id] !== TERRAIN.mountains) continue;
    for (const hex of neighbors(hexFromId(id, grid.width))) {
      if (!inBounds(hex, grid.width, grid.height)) continue;
      const next = hexId(hex, grid.width);
      if (terrain[next] === TERRAIN.plains) terrain[next] = TERRAIN.hills;
    }
    if (id % 15 === 0) features[id] = FEATURE.pass;
  }
}

function directionBetween(from: Hex, to: Hex): Direction | null {
  for (let direction = 0; direction < 6; direction += 1) {
    const next = neighbor(from, direction as Direction);
    if (next.q === to.q && next.r === to.r) return direction as Direction;
  }
  return null;
}

function riverEdges(
  shapes: readonly Shape[],
  grid: Grid,
  terrain: Uint8Array,
): [number, number, number][] {
  const edges: [number, number, number][] = [];
  const seen = new Set<string>();
  const dry = (hex: Hex): boolean =>
    inBounds(hex, grid.width, grid.height) && terrain[hexId(hex, grid.width)] !== TERRAIN.water;
  const flush = (path: Hex[]): void => {
    for (const edge of riverFromHexPath(path, (h) => inBounds(h, grid.width, grid.height))) {
      const key = edge.join(',');
      const other = neighbor({ q: edge[0], r: edge[1] }, edge[2] as Direction);
      if (seen.has(key) || !dry({ q: edge[0], r: edge[1] }) || !dry(other)) continue;
      seen.add(key);
      edges.push(edge);
    }
  };
  for (const shape of shapes)
    for (const part of shape.parts) {
      const path: Hex[] = [];
      for (const point of part) {
        const hex = pointHex(grid, point);
        const last = path[path.length - 1];
        if (last && last.q === hex.q && last.r === hex.r) continue;
        if (last && directionBetween(last, hex) === null) {
          // Редкие точки реки: недостающие гексы берём по линии сетки.
          path.push(...line(last, hex).slice(1));
        } else path.push(hex);
      }
      flush(path);
    }
  return edges;
}

/** Спавны: самый далёкий от выбранных (любой префикс разнесён), не ближе MIN_SPAWN_GAP. */
function chooseSpawns(
  terrain: Uint8Array,
  land: ReadonlySet<number>,
  grid: Grid,
  count: number,
): Hex[] {
  const { width, height } = grid;
  const candidates = Array.from(land)
    .sort((a, b) => a - b)
    .map((id) => hexFromId(id, width))
    .filter((hex) => {
      const code = terrain[hexId(hex, width)];
      if (code !== TERRAIN.plains && code !== TERRAIN.forest) return false;
      const around = [hex, ...neighbors(hex)].filter((n) => inBounds(n, width, height));
      return around.filter((n) => terrain[hexId(n, width)] !== TERRAIN.water).length >= 7;
    });
  const first = candidates[Math.floor(candidates.length / 2)];
  if (!first) throw new Error('нет суши для спавнов');
  const spawns: Hex[] = [first];
  const nearest = candidates.map((hex) => distance(hex, first));
  while (spawns.length < count) {
    let bestIndex = -1;
    let bestGap = MIN_SPAWN_GAP - 1;
    nearest.forEach((gap, index) => {
      if (gap > bestGap) {
        bestGap = gap;
        bestIndex = index;
      }
    });
    const best = candidates[bestIndex];
    if (!best) throw new Error(`разместилось ${spawns.length} спавнов из ${count}`);
    spawns.push(best);
    candidates.forEach((hex, index) => {
      nearest[index] = Math.min(nearest[index] ?? 0, distance(hex, best));
    });
  }
  return spawns;
}

/** Собирает карту региона по слоям Natural Earth. */
export function buildRegionMap(
  region: Region,
  grid: Grid,
  layers: Layers,
  center: Center,
): { json: MapJson } {
  const { width, height } = grid;
  const options = { width, height, players: region.players };
  const terrain = rasterTerrain(grid, layers);
  applyEdits(terrain, grid, center, region);
  const features = new Uint8Array(terrain.length);
  softenMountains(terrain, features, grid);
  // Спавны и города — только на связной суше: никаких островов с игроками и мостов через море.
  const land = largestRoadableLand(terrain, features, options);
  const spawns = chooseSpawns(terrain, land, grid, region.players);
  for (const spawn of spawns)
    for (const hex of [spawn, ...neighbors(spawn)]) {
      if (inBounds(hex, width, height)) features[hexId(hex, width)] = FEATURE.none;
    }
  const cities = chooseCities(region.seed, terrain, features, spawns, land, options);
  const roads = generateRoads(terrain, features, [...cities, ...spawns], options);
  return {
    json: {
      version: 1,
      id: region.id,
      width,
      height,
      terrain: encodeBase64(terrain),
      features: Array.from(features).flatMap((feature, id) =>
        feature === FEATURE.none
          ? []
          : [
              {
                ...hexFromId(id, width),
                type:
                  feature === FEATURE.pass ? 'pass' : feature === FEATURE.mine ? 'mine' : 'fertile',
              },
            ],
      ),
      riverEdges: riverEdges(layers.rivers, grid, terrain),
      roads: encodeBase64(packBits(roads)),
      cities: cities.map((city, index) => ({
        ...city,
        name: CITY_NAMES[index % CITY_NAMES.length] ?? city.name,
      })),
      spawns,
    },
  };
}

const GLYPHS = '~.fhMd';

/** Текстовый набросок карты: ~ вода, . равнина, f лес, h холмы, M горы, d пустыня, S спавн, C город. */
export function asciiSketch(json: MapJson): string {
  const terrain = decodeBase64(json.terrain) ?? new Uint8Array(0);
  const rows: string[][] = [];
  for (let row = 0; row < json.height; row += 1) {
    const cells: string[] = [];
    for (let col = 0; col < json.width; col += 1)
      cells.push(GLYPHS[terrain[col + row * json.width] ?? 0] ?? '?');
    rows.push(cells);
  }
  const mark = (hex: Hex, glyph: string): void => {
    const row = hex.r + Math.floor((hex.q + (hex.q & 1)) / 2);
    const target = rows[row];
    if (target && hex.q >= 0 && hex.q < json.width) target[hex.q] = glyph;
  };
  for (const city of json.cities) mark(city, 'C');
  for (const spawn of json.spawns) mark(spawn, 'S');
  return rows.map((cells) => cells.join('')).join('\n');
}

/** Окно наброска вокруг гекса `at`: нечётные столбцы смещены на полстроки, как в игре. */
export function asciiWindow(
  json: MapJson,
  at: Hex,
  halfWidth: number,
  halfHeight: number,
  marks: ReadonlyMap<string, string> = new Map(),
): string {
  const terrain = decodeBase64(json.terrain) ?? new Uint8Array(0);
  const city = new Set(json.cities.map((c) => `${c.q},${c.r}`));
  const spawn = new Set(json.spawns.map((s) => `${s.q},${s.r}`));
  const centerCol = at.q;
  const centerRow = at.r + Math.floor((at.q + (at.q & 1)) / 2);
  const out: string[] = [];
  for (let row = centerRow - halfHeight; row <= centerRow + halfHeight; row += 1) {
    for (const parity of [0, 1]) {
      let text = '';
      for (let col = centerCol - halfWidth; col <= centerCol + halfWidth; col += 1) {
        if ((col & 1) !== parity) {
          text += '  ';
          continue;
        }
        const q = col;
        const r = row - Math.floor((col + (col & 1)) / 2);
        const code =
          col >= 0 && col < json.width && row >= 0 && row < json.height
            ? terrain[col + row * json.width]
            : undefined;
        const glyph =
          marks.get(`${q},${r}`) ??
          (spawn.has(`${q},${r}`) ? 'S' : city.has(`${q},${r}`) ? 'C' : (GLYPHS[code ?? 0] ?? ' '));
        text += `${glyph} `;
      }
      out.push(text);
    }
  }
  return out.join('\n');
}
