import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FEATURE,
  TERRAIN,
  encodeBase64,
  distance,
  hexFromId,
  hexId,
  neighbor,
  neighbors,
  packBits,
  type Direction,
  type Hex,
  type MapJson,
} from '@hexfront/sim';

import { CITY_NAMES, chooseCities, largestRoadableLand } from '../src/map.ts';
import { riverFromHexPath } from '../src/rivers.ts';
import { generateRoads } from '../src/roads.ts';

const SOURCES = {
  land: 'ne_10m_land',
  lakes: 'ne_10m_lakes',
  rivers: 'ne_10m_rivers_lake_centerlines',
  mountains: 'ne_10m_geography_regions_polys',
} as const;
const DOWNLOAD_ROOT = 'https://naciscdn.org/naturalearth/10m/physical';
const PROJECTION = 'EPSG:3035';
const BOUNDS = { minLon: -11, maxLon: 40, minLat: 35, maxLat: 71 } as const;
const TARGET_PLAYERS = 30;
const RADIUS = 6_371_000;
const CENTER = { lon: (10 * Math.PI) / 180, lat: (52 * Math.PI) / 180 };

interface Point {
  readonly x: number;
  readonly y: number;
}
interface Shape {
  readonly parts: readonly Point[][];
  readonly featureClass: string;
}

function readInt(buffer: Buffer, offset: number): number {
  return buffer.readInt32LE(offset);
}
function readDbfValue(buffer: Buffer, offset: number, length: number): string {
  return buffer.toString('latin1', offset, offset + length).trim();
}

function dbfFeatureClasses(buffer: Buffer): string[] {
  const records = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields: { name: string; offset: number; length: number }[] = [];
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    const name = buffer.toString('ascii', offset, offset + 11).replace(/\0.*$/, '');
    fields.push({
      name,
      offset: buffer.readUInt32LE(offset + 12),
      length: buffer[offset + 16] ?? 0,
    });
  }
  const field = fields.find((item) => item.name.toLowerCase() === 'featurecla');
  if (!field) return Array.from({ length: records }, () => '');
  return Array.from({ length: records }, (_, index) =>
    readDbfValue(buffer, headerLength + index * recordLength + field.offset, field.length),
  );
}

async function readShapes(directory: string, name: string): Promise<Shape[]> {
  const shp = await readFile(join(directory, `${name}.shp`));
  const dbf = await readFile(join(directory, `${name}.dbf`));
  const classes = dbfFeatureClasses(dbf);
  const shapes: Shape[] = [];
  let offset = 100;
  while (offset + 8 <= shp.length) {
    const words = shp.readInt32BE(offset + 4);
    const recordEnd = offset + 8 + words * 2;
    const type = readInt(shp, offset + 8);
    if ((type === 3 || type === 5) && recordEnd <= shp.length) {
      const partsCount = readInt(shp, offset + 8 + 36);
      const pointsCount = readInt(shp, offset + 8 + 40);
      const partsOffset = offset + 8 + 44;
      const pointsOffset = partsOffset + partsCount * 4;
      const points = Array.from({ length: pointsCount }, (_, index) => ({
        x: shp.readDoubleLE(pointsOffset + index * 16),
        y: shp.readDoubleLE(pointsOffset + index * 16 + 8),
      }));
      const parts = Array.from({ length: partsCount }, (_, index) => {
        const start = shp.readInt32LE(partsOffset + index * 4);
        const end =
          index + 1 < partsCount ? shp.readInt32LE(partsOffset + (index + 1) * 4) : pointsCount;
        return points.slice(start, end);
      });
      shapes.push({
        parts: parts.map((part) => part.map((point) => project(point.x, point.y))),
        featureClass: classes[shapes.length] ?? '',
      });
    }
    offset = recordEnd;
  }
  return shapes;
}

function project(lon: number, lat: number): Point {
  const longitude = (lon * Math.PI) / 180;
  const latitude = (lat * Math.PI) / 180;
  const sinLat = Math.sin(latitude);
  const cosLat = Math.cos(latitude);
  const sinCenter = Math.sin(CENTER.lat);
  const cosCenter = Math.cos(CENTER.lat);
  const delta = longitude - CENTER.lon;
  const scale = Math.sqrt(2 / (1 + sinCenter * sinLat + cosCenter * cosLat * Math.cos(delta)));
  return {
    x: RADIUS * scale * cosLat * Math.sin(delta),
    y: RADIUS * scale * (cosCenter * sinLat - sinCenter * cosLat * Math.cos(delta)),
  };
}

function inside(point: Point, shapes: readonly Shape[]): boolean {
  return shapes.some((shape) =>
    shape.parts.some((ring) => {
      let result = false;
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
        const left = ring[index];
        const right = ring[previous];
        if (!left || !right) continue;
        if (
          left.y > point.y !== right.y > point.y &&
          point.x < ((right.x - left.x) * (point.y - left.y)) / (right.y - left.y) + left.x
        )
          result = !result;
      }
      return result;
    }),
  );
}

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly min: Point;
  readonly max: Point;
}

/** Всего гексов сетки: хватает на 30 спавнов с зазором и сушу побольше воды. */
const GRID_HEXES = 9000;

// Прямоугольник проекции: ширина — по долготам на 50° с.ш., высота — по широтам на 10° в.д., без
// срезанных углов: у границы карты тоже настоящая суша, а не вода.
function gridSize(): Grid {
  const west = project(BOUNDS.minLon, 50).x;
  const east = project(BOUNDS.maxLon, 50).x;
  const south = project(10, BOUNDS.minLat).y;
  const north = project(10, BOUNDS.maxLat).y;
  const min = { x: west, y: south };
  const max = { x: east, y: north };
  // Шаг гекса flat-top: 1,5 R по x и √3 R по y, поэтому ширина/высота сетки = 1,1547 × пропорция.
  const ratio = (max.x - min.x) / (max.y - min.y);
  const width = Math.ceil(Math.sqrt(GRID_HEXES * ratio * 1.1547));
  return { width, height: Math.ceil(GRID_HEXES / width), min, max };
}

// Центр гекса (even-q: нечётные столбцы сдвинуты вниз на полгекса) в проекции; север сверху.
function hexPoint(grid: Grid, col: number, row: number): Point {
  const rows = grid.height + 0.5;
  return {
    x: grid.min.x + ((col + 0.5) / grid.width) * (grid.max.x - grid.min.x),
    y: grid.max.y - ((row + 0.5 * (col & 1) + 0.5) / rows) * (grid.max.y - grid.min.y),
  };
}

// Обратное преобразование: ближайший гекс к точке проекции.
function pointHex(grid: Grid, point: Point): Hex {
  const col = Math.max(
    0,
    Math.min(
      grid.width - 1,
      Math.round(((point.x - grid.min.x) / (grid.max.x - grid.min.x)) * grid.width - 0.5),
    ),
  );
  const rows = grid.height + 0.5;
  const row = Math.max(
    0,
    Math.min(
      grid.height - 1,
      Math.round(
        ((grid.max.y - point.y) / (grid.max.y - grid.min.y)) * rows - 0.5 - 0.5 * (col & 1),
      ),
    ),
  );
  return hexFromId(col + row * grid.width, grid.width);
}

// Детерминированный шум 0–99 по клетке: лес и холмы пятнами из нескольких гексов, а не диагональными
// полосами проекции.
function noise(col: number, row: number): number {
  let h = Math.imul(col, 374761393) + Math.imul(row, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) % 100;
}

function terrainAt(
  point: Point,
  col: number,
  row: number,
  land: readonly Shape[],
  lakes: readonly Shape[],
  mountains: readonly Shape[],
): number {
  if (!inside(point, land) || inside(point, lakes)) return TERRAIN.water;
  // В хребтах каждый третий гекс — холмы: проходы через горы, а не сплошная стена.
  if (inside(point, mountains)) {
    return noise(col, row) % 3 === 0 ? TERRAIN.hills : TERRAIN.mountains;
  }
  const value = noise(Math.floor(col / 3), Math.floor(row / 3));
  if (value > 62) return TERRAIN.forest;
  return value % 9 === 0 ? TERRAIN.hills : TERRAIN.plains;
}

function directionBetween(from: Hex, to: Hex): Direction | null {
  for (let direction = 0; direction < 6; direction += 1) {
    const next = neighbor(from, direction as Direction);
    if (next.q === to.q && next.r === to.r) return direction as Direction;
  }
  return null;
}

function riverEdges(shapes: readonly Shape[], grid: Grid): [number, number, number][] {
  const edges: [number, number, number][] = [];
  const seen = new Set<string>();
  const flush = (path: Hex[]): void => {
    // Путь по соседним гексам → непрерывная цепочка граней (стык в общих углах, не обрывки).
    for (const edge of riverFromHexPath(path, (h) => inBounds(h, grid.width, grid.height))) {
      const key = edge.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(edge);
    }
  };
  for (const shape of shapes)
    for (const part of shape.parts) {
      let path: Hex[] = [];
      for (const point of part) {
        const hex = pointHex(grid, point);
        const last = path[path.length - 1];
        if (last && last.q === hex.q && last.r === hex.r) continue;
        if (last && directionBetween(last, hex) === null) {
          flush(path);
          path = [];
        }
        path.push(hex);
      }
      flush(path);
    }
  return edges;
}

/** Спавны с зазором не меньше MIN_SPAWN_GAP, порядок — от самого далёкого от выбранных: любой префикс разнесён. */
const MIN_SPAWN_GAP = 7;

function chooseEuropeSpawns(
  terrain: Uint8Array,
  land: ReadonlySet<number>,
  width: number,
  height: number,
): Hex[] {
  const candidates = Array.from(land)
    .sort((a, b) => a - b)
    .map((id) => hexFromId(id, width))
    .filter((hex) => {
      const code = terrain[hexId(hex, width)];
      if (code !== TERRAIN.plains && code !== TERRAIN.forest) return false;
      const around = [hex, ...neighbors(hex)].filter(
        (n) => n.q >= 0 && n.r >= 0 && n.q < width && n.r < height,
      );
      return around.filter((n) => terrain[hexId(n, width)] !== TERRAIN.water).length >= 7;
    });
  const spawns: Hex[] = [];
  const first = candidates[Math.floor(candidates.length / 2)];
  if (!first) throw new Error('Европа: нет суши для спавнов');
  spawns.push(first);
  const nearest = new Map<number, number>(
    candidates.map((hex) => [hexId(hex, width), distance(hex, first)]),
  );
  while (spawns.length < TARGET_PLAYERS) {
    let best: Hex | null = null;
    let bestGap = MIN_SPAWN_GAP - 1;
    for (const hex of candidates) {
      const gap = nearest.get(hexId(hex, width)) ?? 0;
      if (gap > bestGap) {
        best = hex;
        bestGap = gap;
      }
    }
    if (!best) break;
    spawns.push(best);
    for (const hex of candidates) {
      const id = hexId(hex, width);
      nearest.set(id, Math.min(nearest.get(id) ?? 0, distance(hex, best)));
    }
  }
  if (spawns.length < TARGET_PLAYERS) {
    throw new Error(`Европа: разместилось ${spawns.length} спавнов из ${TARGET_PLAYERS}`);
  }
  return spawns;
}

function buildMap(seed: number, shapes: Record<keyof typeof SOURCES, Shape[]>): MapJson {
  const grid = gridSize();
  const { width, height } = grid;
  const options = { width, height, players: TARGET_PLAYERS };
  const terrain = new Uint8Array(width * height);
  const features = new Uint8Array(terrain.length);
  for (let id = 0; id < terrain.length; id += 1) {
    const point = hexPoint(grid, id % width, Math.floor(id / width));
    terrain[id] = terrainAt(
      point,
      id % width,
      Math.floor(id / width),
      shapes.land,
      shapes.lakes,
      shapes.mountains,
    );
  }
  for (let id = 0; id < terrain.length; id += 1)
    if (terrain[id] === TERRAIN.mountains) {
      for (const hex of neighbors(hexFromId(id, width))) {
        if (hex.q < 0 || hex.r < 0 || hex.q >= width || hex.r >= height) continue;
        const next = hexId(hex, width);
        if (terrain[next] === TERRAIN.plains) terrain[next] = TERRAIN.hills;
      }
      if (id % 15 === 0) features[id] = FEATURE.pass;
    }
  // Спавны и города — только на материковой суше: никаких островов с игроками и мостов через море.
  const land = largestRoadableLand(terrain, features, options);
  const spawns = chooseEuropeSpawns(terrain, land, width, height);
  for (const spawn of spawns)
    for (const hex of [spawn, ...neighbors(spawn)]) {
      if (hex.q >= 0 && hex.r >= 0 && hex.q < width && hex.r < height)
        features[hexId(hex, width)] = FEATURE.none;
    }
  const cities = chooseCities(seed, terrain, features, spawns, land, options);
  const roads = generateRoads(terrain, features, [...cities, ...spawns], options);
  return {
    version: 1,
    id: `europe-natural-earth-10m-${PROJECTION.toLowerCase().replace(':', '')}`,
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
    riverEdges: riverEdges(shapes.rivers, grid),
    roads: encodeBase64(packBits(roads)),
    cities: cities.map((city, index) => ({
      ...city,
      name: CITY_NAMES[index % CITY_NAMES.length] ?? city.name,
    })),
    spawns,
  };
}

async function downloadAndExtract(directory: string, name: string): Promise<void> {
  const archive = join(directory, `${name}.zip`);
  const response = await fetch(`${DOWNLOAD_ROOT}/${name}.zip`);
  if (!response.ok)
    throw new Error(`Natural Earth: загрузка ${name} завершилась ${response.status}`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync('tar', ['-xf', archive, '-C', directory]);
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hexfront-europe-'));
  try {
    for (const name of Object.values(SOURCES)) await downloadAndExtract(directory, name);
    const shapes = {
      land: await readShapes(directory, SOURCES.land),
      lakes: await readShapes(directory, SOURCES.lakes),
      rivers: await readShapes(directory, SOURCES.rivers),
      mountains: (await readShapes(directory, SOURCES.mountains)).filter(
        (shape) => shape.featureClass === 'Range/mtn',
      ),
    };
    const output = buildMap(42, shapes);
    await writeFile(
      new URL('../maps/europe.json', import.meta.url),
      `${JSON.stringify(output)}\n`,
      'utf8',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
