// Сборка карт реальной географии из Natural Earth (общественное достояние, версия 5.x, скачано
// с https://naciscdn.org/naturalearth/10m/physical в день запуска): суша ne_10m_land, озёра
// ne_10m_lakes, реки ne_10m_rivers_lake_centerlines (+ ne_10m_rivers_europe / _north_america),
// хребты и пустыни ne_10m_geography_regions_polys. Проекция — равновеликая азимутальная Ламберта
// (EPSG:3035 для Европы; у остальных регионов центр в середине рамки).
// Сырые данные скачиваются во временный каталог (mkdtemp) и удаляются; в репозитории лежат только
// готовые `maps/<id>.json`.
// Запуск: pnpm --filter @hexfront/mapgen natural-earth [id ...] [--ascii] [--crop=широта,долгота,полуширина,полувысота]
//   без id собираются все регионы из regions.ts; --ascii печатает набросок береговой линии.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type MapJson } from '@hexfront/sim';

import { makeGrid, pointHex } from './raster.ts';
import { buildRegionMap, asciiSketch, asciiWindow, type Layers } from './region-map.ts';
import { REGIONS, type Region } from './regions.ts';
import { readShapes, project, type Center } from './shapefile.ts';

const DOWNLOAD_ROOT = 'https://naciscdn.org/naturalearth/10m/physical';

function centerOf(region: Region): Center {
  const { minLon, maxLon, minLat, maxLat } = region.bounds;
  // Европа исторически в EPSG:3035: центр 10° в.д., 52° с.ш.
  if (region.id === 'europe') return { lon: 10, lat: 52 };
  return { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 };
}

/** Прямоугольник проекции, описанный вокруг четырёхугольника рамки долгот и широт (границы дуг). */
function rectangle(region: Region, center: Center) {
  const { minLon, maxLon, minLat, maxLat } = region.bounds;
  const steps = 60;
  let low = { x: Infinity, y: Infinity };
  let high = { x: -Infinity, y: -Infinity };
  for (let i = 0; i <= steps; i += 1) {
    const lon = minLon + ((maxLon - minLon) * i) / steps;
    const lat = minLat + ((maxLat - minLat) * i) / steps;
    for (const [pLon, pLat] of [
      [lon, minLat],
      [lon, maxLat],
      [minLon, lat],
      [maxLon, lat],
    ] as const) {
      const p = project(pLon, pLat, center);
      low = { x: Math.min(low.x, p.x), y: Math.min(low.y, p.y) };
      high = { x: Math.max(high.x, p.x), y: Math.max(high.y, p.y) };
    }
  }
  return { min: low, max: high };
}

async function download(directory: string, name: string): Promise<void> {
  const response = await fetch(`${DOWNLOAD_ROOT}/${name}.zip`);
  if (!response.ok)
    throw new Error(`Natural Earth: загрузка ${name} завершилась ${response.status}`);
  const archive = join(directory, `${name}.zip`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  // На Windows в PATH может стоять GNU tar из Git, не умеющий zip: берём системный bsdtar.
  const tar = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', directory]);
}

async function layersFor(region: Region, directory: string, center: Center): Promise<Layers> {
  const rect = rectangle(region, center);
  const margin = 0.1 * (rect.max.x - rect.min.x);
  const keep = {
    min: { x: rect.min.x - margin, y: rect.min.y - margin },
    max: { x: rect.max.x + margin, y: rect.max.y + margin },
  };
  const read = (name: string) => readShapes(directory, name, center, keep);
  const regions = await read('ne_10m_geography_regions_polys');
  const rivers = await read('ne_10m_rivers_lake_centerlines');
  for (const extra of region.extraRivers) {
    const shapes = await read(`ne_10m_${extra.layer}`);
    rivers.push(...shapes.filter((shape) => extra.ranks.includes(shape.attrs.scalerank ?? '')));
  }
  return {
    land: await read('ne_10m_land'),
    lakes: await read('ne_10m_lakes'),
    rivers,
    mountains: regions.filter((shape) => shape.attrs.featurecla === 'Range/mtn'),
    deserts: region.desert ? regions.filter((shape) => shape.attrs.featurecla === 'Desert') : [],
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ascii = args.includes('--ascii');
  const ids = args.filter((arg) => !arg.startsWith('--'));
  const chosen = ids.length === 0 ? REGIONS : REGIONS.filter((region) => ids.includes(region.id));
  if (chosen.length === 0) throw new Error('Нет такого региона');
  const directory = await mkdtemp(join(tmpdir(), 'hexfront-natural-earth-'));
  try {
    const names = ['land', 'lakes', 'rivers_lake_centerlines', 'geography_regions_polys'];
    for (const region of chosen) for (const extra of region.extraRivers) names.push(extra.layer);
    for (const name of new Set(names))
      await download(directory, `ne_10m_${name.replace(/^ne_10m_/, '')}`);
    for (const region of chosen) {
      const center = centerOf(region);
      const rect = rectangle(region, center);
      const grid = makeGrid(rect.min, rect.max, region.hexes);
      const layers = await layersFor(region, directory, center);
      const built = buildRegionMap(region, grid, layers, center);
      const json: MapJson = built.json;
      await writeFile(
        new URL(`../maps/${region.id}.json`, import.meta.url),
        `${JSON.stringify(json)}\n`,
        'utf8',
      );
      process.stdout.write(
        `${region.id}: ${grid.width}x${grid.height}, спавнов ${json.spawns.length}, городов ${json.cities.length}, рек ${json.riverEdges.length} граней\n`,
      );
      if (ascii) process.stdout.write(`${asciiSketch(json)}\n`);
      const crop = args.find((arg) => arg.startsWith('--crop='));
      if (crop) {
        const [lat = 0, lon = 0, w = 20, h = 10] = crop.slice(7).split(',').map(Number);
        const hex = pointHex(grid, project(lon, lat, center));
        const marks = new Map<string, string>();
        const markArg = args.find((arg) => arg.startsWith('--marks=')) ?? '--marks=';
        for (const item of markArg.slice(8).split(';')) {
          const [mLat = 0, mLon = 0, glyph = ''] = item.split(',');
          const markHex = pointHex(grid, project(Number(mLon), Number(mLat), center));
          if (glyph) marks.set(`${markHex.q},${markHex.r}`, glyph);
        }
        process.stdout.write(`${asciiWindow(json, hex, w, h, marks)}\n`);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
