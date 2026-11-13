// Сборка процедурных карт menu: «материк» (generateMap с реками) и «острова» (материк, разрезанный
// на острова с узкими перешейками). Сиды фиксированы, результат воспроизводим.
// Запуск: pnpm --filter @hexfront/mapgen procedural
import { writeFileSync } from 'node:fs';

import {
  FEATURE,
  TERRAIN,
  hexFromId,
  hexId,
  inBounds,
  loadMap,
  neighbor,
  neighbors,
  type Direction,
} from '@hexfront/sim';

import { assembleMap, generateMap, generateTerrain } from '../src/index.ts';

function write(id: string, json: unknown): void {
  const loaded = loadMap(json);
  if (!loaded.ok) throw new Error(`${id}: ${loaded.errors.join('; ')}`);
  writeFileSync(
    new URL(`../maps/${id}.json`, import.meta.url),
    `${JSON.stringify(json)}\n`,
    'utf8',
  );
  process.stdout.write(
    `${id}: ${loaded.map.width}x${loaded.map.height}, спавнов ${loaded.map.spawns.length}, городов ${loaded.map.cities.length}\n`,
  );
}

function hash(a: number, b: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

const SITES = 10;
const EXTRA_GATE_PERCENT = 25;

/** Разрезает сушу на острова по границам ячеек Вороного; перешейки оставляют карту связной. */
function archipelago(seed: number, width: number, height: number, players: number) {
  const base = generateTerrain(seed, { width, height, players });
  const terrain = base.terrain.slice();
  const features = base.features.slice();
  const sites = Array.from({ length: SITES }, (_, i) => ({
    col: 6 + (hash(seed, i * 2) % (width - 12)),
    row: 6 + (hash(seed, i * 2 + 1) % (height - 12)),
  }));
  const owner = new Uint8Array(terrain.length);
  for (let id = 0; id < owner.length; id += 1) {
    let best = 0;
    let bestDistance = Infinity;
    sites.forEach((site, index) => {
      const d = (site.col - (id % width)) ** 2 + 1.3 * (site.row - Math.floor(id / width)) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    });
    owner[id] = best;
  }
  // Клетка с соседом из ячейки с большим номером становится морем: граница в один гекс.
  const cut: number[] = [];
  const gates = new Map<string, number>();
  for (let id = 0; id < owner.length; id += 1) {
    if (terrain[id] === TERRAIN.water) continue;
    const mine = owner[id] ?? 0;
    for (const hex of neighbors(hexFromId(id, width))) {
      if (!inBounds(hex, width, height)) continue;
      const other = owner[hexId(hex, width)] ?? 0;
      if (other <= mine) continue;
      cut.push(id);
      const key = `${mine}-${other}`;
      // Перешеек каждой пары — клетка границы с наименьшим хешем: выбор не зависит от порядка.
      const current = gates.get(key);
      if (current === undefined || hash(id, 77) < hash(current, 77)) gates.set(key, id);
      break;
    }
  }
  const keep = new Set<number>();
  [...gates.entries()].forEach(([key, id], index) => {
    if (index % 4 === 0 || hash(index, 5) % 100 < EXTRA_GATE_PERCENT) keep.add(id);
    void key;
  });
  for (const id of cut) {
    if (keep.has(id)) continue;
    terrain[id] = TERRAIN.water;
    features[id] = FEATURE.none;
  }
  const dry = (q: number, r: number): boolean =>
    inBounds({ q, r }, width, height) && terrain[hexId({ q, r }, width)] !== TERRAIN.water;
  const riverEdges = base.riverEdges.filter(([q, r, dir]) => {
    const other = neighbor({ q, r }, dir as Direction);
    return dry(q, r) && dry(other.q, other.r);
  });
  return assembleMap(
    seed,
    'archipelago',
    { terrain, features, riverEdges },
    { width, height, players },
  );
}

const continent = generateMap(2024, { width: 110, height: 80, players: 24 });
write('continent', { ...continent, id: 'continent' });
write('archipelago', archipelago(31, 100, 70, 18));
