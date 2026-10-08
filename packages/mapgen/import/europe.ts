import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FEATURE,
  TERRAIN,
  encodeBase64,
  hexFromId,
  hexId,
  neighbor,
  neighbors,
  packBits,
  type Direction,
  type Hex,
  type MapJson,
} from '@hexfront/sim';

import { CITY_NAMES, generateMap } from '../src/map.ts';
import { PASSABLE_HEXES_PER_PLAYER } from '../src/params.ts';
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

function gridSize(): { width: number; height: number; min: Point; max: Point } {
  const corners = [
    project(BOUNDS.minLon, BOUNDS.minLat),
    project(BOUNDS.minLon, BOUNDS.maxLat),
    project(BOUNDS.maxLon, BOUNDS.minLat),
    project(BOUNDS.maxLon, BOUNDS.maxLat),
  ];
  const min = {
    x: Math.min(...corners.map((point) => point.x)),
    y: Math.min(...corners.map((point) => point.y)),
  };
  const max = {
    x: Math.max(...corners.map((point) => point.x)),
    y: Math.max(...corners.map((point) => point.y)),
  };
  const area = TARGET_PLAYERS * PASSABLE_HEXES_PER_PLAYER * 1.35;
  const ratio = (max.x - min.x) / (max.y - min.y);
  const width = Math.ceil(Math.sqrt(area * ratio));
  return { width, height: Math.ceil(area / width), min, max };
}

function terrainAt(
  point: Point,
  land: readonly Shape[],
  lakes: readonly Shape[],
  mountains: readonly Shape[],
): number {
  if (!inside(point, land) || inside(point, lakes)) return TERRAIN.water;
  if (inside(point, mountains)) return TERRAIN.mountains;
  const value = Math.abs(Math.trunc(point.x / 1000) * 31 + Math.trunc(point.y / 1000) * 17) % 100;
  if (value < 12) return TERRAIN.desert;
  if (value > 68) return TERRAIN.forest;
  return value % 7 === 0 ? TERRAIN.hills : TERRAIN.plains;
}

function directionBetween(from: Hex, to: Hex): Direction | null {
  for (let direction = 0; direction < 6; direction += 1) {
    const next = neighbor(from, direction as Direction);
    if (next.q === to.q && next.r === to.r) return direction as Direction;
  }
  return null;
}

function connectNodes(
  terrain: Uint8Array,
  nodes: readonly Hex[],
  width: number,
  height: number,
): void {
  const anchor = nodes[0];
  if (!anchor) return;
  for (const node of nodes) {
    const target = hexId(node, width);
    const previous = new Int32Array(width * height).fill(-1);
    const queue = [hexId(anchor, width)];
    previous[queue[0] as number] = queue[0] as number;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const currentId = queue[cursor];
      if (currentId === undefined || currentId === target) break;
      for (const next of neighbors(hexFromId(currentId, width))) {
        if (next.q < 0 || next.r < 0 || next.q >= width || next.r >= height) continue;
        const nextId = hexId(next, width);
        if (previous[nextId] !== -1) continue;
        previous[nextId] = currentId;
        queue.push(nextId);
      }
    }
    for (
      let current = target;
      current !== previous[current] && current >= 0;
      current = previous[current] ?? -1
    ) {
      terrain[current] = TERRAIN.plains;
    }
  }
}

function riverEdges(
  shapes: readonly Shape[],
  min: Point,
  max: Point,
  width: number,
  height: number,
): [number, number, number][] {
  const edges: [number, number, number][] = [];
  for (const shape of shapes)
    for (const part of shape.parts)
      for (let index = 1; index < part.length; index += 1) {
        const previous = part[index - 1];
        const current = part[index];
        if (!previous || !current) continue;
        const a = hexFromId(
          Math.max(
            0,
            Math.min(
              width * height - 1,
              Math.round(((previous.y - min.y) / (max.y - min.y)) * height) * width +
                Math.round(((previous.x - min.x) / (max.x - min.x)) * width),
            ),
          ),
          width,
        );
        const b = hexFromId(
          Math.max(
            0,
            Math.min(
              width * height - 1,
              Math.round(((current.y - min.y) / (max.y - min.y)) * height) * width +
                Math.round(((current.x - min.x) / (max.x - min.x)) * width),
            ),
          ),
          width,
        );
        const direction = directionBetween(a, b);
        if (direction !== null && direction <= 2) {
          const next = neighbor(a, direction);
          if (next.q >= 0 && next.r >= 0 && next.q < width && next.r < height)
            edges.push([a.q, a.r, direction]);
        }
      }
  return edges;
}

function buildMap(seed: number, shapes: Record<keyof typeof SOURCES, Shape[]>): MapJson {
  const grid = gridSize();
  const base = generateMap(seed, {
    width: grid.width,
    height: grid.height,
    players: TARGET_PLAYERS,
  });
  const terrain = new Uint8Array(base.width * base.height);
  const features = new Uint8Array(terrain.length);
  for (let id = 0; id < terrain.length; id += 1) {
    const point = {
      x: grid.min.x + (((id % base.width) + 0.5) / base.width) * (grid.max.x - grid.min.x),
      y:
        grid.min.y +
        ((Math.floor(id / base.width) + 0.5) / base.height) * (grid.max.y - grid.min.y),
    };
    terrain[id] = terrainAt(point, shapes.land, shapes.lakes, shapes.mountains);
  }
  for (const spawn of base.spawns)
    for (const hex of [
      spawn,
      ...Array.from({ length: 6 }, (_, direction) => neighbor(spawn, direction as Direction)),
    ]) {
      if (hex.q >= 0 && hex.r >= 0 && hex.q < base.width && hex.r < base.height)
        terrain[hexId(hex, base.width)] = TERRAIN.plains;
    }
  for (const city of base.cities) terrain[hexId(city, base.width)] = TERRAIN.plains;
  connectNodes(terrain, [...base.cities, ...base.spawns], base.width, base.height);
  for (let id = 0; id < terrain.length; id += 1)
    if (terrain[id] === TERRAIN.mountains) {
      for (const hex of [
        hexFromId(id, base.width),
        ...Array.from({ length: 6 }, (_, direction) =>
          neighbor(hexFromId(id, base.width), direction as Direction),
        ),
      ]) {
        if (hex.q < 0 || hex.r < 0 || hex.q >= base.width || hex.r >= base.height) continue;
        const next = hexId(hex, base.width);
        if (terrain[next] === TERRAIN.plains) terrain[next] = TERRAIN.hills;
      }
      if (id % 15 === 0) features[id] = FEATURE.pass;
    }
  const roadTerrain = new Uint8Array(terrain.length).fill(TERRAIN.plains);
  const roads = generateRoads(roadTerrain, features, [...base.cities, ...base.spawns], {
    width: base.width,
    height: base.height,
    players: TARGET_PLAYERS,
  });
  roads.forEach((road, id) => {
    if (road === 1) terrain[id] = TERRAIN.plains;
  });
  return {
    ...base,
    id: `europe-natural-earth-10m-${PROJECTION.toLowerCase().replace(':', '')}`,
    terrain: encodeBase64(terrain),
    features: Array.from(features).flatMap((feature, id) =>
      feature === FEATURE.none
        ? []
        : [
            {
              ...hexFromId(id, base.width),
              type:
                feature === FEATURE.pass ? 'pass' : feature === FEATURE.mine ? 'mine' : 'fertile',
            },
          ],
    ),
    riverEdges: riverEdges(shapes.rivers, grid.min, grid.max, base.width, base.height),
    roads: encodeBase64(packBits(roads)),
    cities: base.cities.map((city, index) => ({
      ...city,
      name: CITY_NAMES[index % CITY_NAMES.length] ?? city.name,
    })),
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
