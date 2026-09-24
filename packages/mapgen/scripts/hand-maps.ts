// Сборка ручных тестовых карт tiny и small из ASCII-рисунков в packages/mapgen/maps/*.json.
// Запуск: pnpm --filter @hexfront/mapgen maps. Каждая карта проверяется валидатором sim.
import { writeFileSync } from 'node:fs';

import {
  TERRAIN,
  encodeBase64,
  hexId,
  line,
  loadMap,
  offsetToAxial,
  packBits,
  type FeatureName,
  type Hex,
  type MapCity,
  type MapJson,
  type TerrainCode,
} from '@hexfront/sim';

/** Точка в offset-координатах (столбец, строка), как на рисунке. */
type At = readonly [col: number, row: number];

interface HandMap {
  readonly id: string;
  readonly rows: readonly string[];
  readonly spawns: readonly At[];
  readonly cities: readonly { at: At; name: string; level: number }[];
  /** Дороги — отрезки между точками по гекс-линии. */
  readonly roads: readonly (readonly [At, At])[];
  /** Реки — по правой стороне столбца `col` от строки `from` до `to` включительно. */
  readonly rivers: readonly { col: number; from: number; to: number }[];
  readonly features: readonly { at: At; type: FeatureName }[];
}

const GLYPHS: Readonly<Record<string, TerrainCode>> = {
  '~': TERRAIN.water,
  '.': TERRAIN.plains,
  f: TERRAIN.forest,
  h: TERRAIN.hills,
  m: TERRAIN.mountains,
  d: TERRAIN.desert,
};

// Гарнизоны по уровню — из NEUTRAL_GARRISON (10-balance.md), в JSON — целые солдаты.
const GARRISON_BY_LEVEL = [150, 300, 600] as const;

const axial = ([col, row]: At): Hex => offsetToAxial({ col, row });

// Рёбра NE (1) и SE (0) гексов одного столбца стыкуются вершинами в непрерывную линию.
const RIVER_DIRS = [1, 0] as const;

function riverRun(run: { col: number; from: number; to: number }): [number, number, number][] {
  const edges: [number, number, number][] = [];
  for (let row = run.from; row <= run.to; row += 1) {
    const h = axial([run.col, row]);
    for (const dir of RIVER_DIRS) edges.push([h.q, h.r, dir]);
  }
  return edges;
}

function buildTerrain(m: HandMap, width: number): Uint8Array {
  const terrain = new Uint8Array(width * m.rows.length);
  m.rows.forEach((row, r) => {
    if (row.length !== width) throw new Error(`${m.id}: строка ${r} длиной ${row.length}`);
    [...row].forEach((ch, c) => {
      const code = GLYPHS[ch];
      if (code === undefined) throw new Error(`${m.id}: неизвестный символ «${ch}»`);
      terrain[c + r * width] = code;
    });
  });
  return terrain;
}

function toJson(m: HandMap): MapJson {
  const width = m.rows[0]?.length ?? 0;
  const roads = new Uint8Array(width * m.rows.length);
  for (const [a, b] of m.roads) {
    for (const h of line(axial(a), axial(b))) roads[hexId(h, width)] = 1;
  }
  const cities: MapCity[] = m.cities.map((c, i) => ({
    id: i + 1,
    ...axial(c.at),
    name: c.name,
    level: c.level,
    garrison: GARRISON_BY_LEVEL[c.level - 1] ?? 0,
  }));
  return {
    version: 1,
    id: m.id,
    width,
    height: m.rows.length,
    terrain: encodeBase64(buildTerrain(m, width)),
    features: m.features.map((f) => ({ ...axial(f.at), type: f.type })),
    riverEdges: m.rivers.flatMap(riverRun),
    roads: encodeBase64(packBits(roads)),
    cities,
    spawns: m.spawns.map(axial),
  };
}

const TINY: HandMap = {
  id: 'tiny',
  rows: [
    '~~~~~~~~~~~~~~~~~~~~',
    '~~....ff.....hh..~~~',
    '~.....fff...hhh...~~',
    '~....ffff....h.....~',
    '~.......f..........~',
    '~..hh.......ddd....~',
    '~..hmm.....dddd..f.~',
    '~...mm.....ddd..fff~',
    '~....h............f~',
    '~.........~~.......~',
    '~..ff....~~~....h..~',
    '~.fff.....~....hhh.~',
    '~..f............h..~',
    '~~................~~',
    '~~~~~~~~~~~~~~~~~~~~',
  ],
  spawns: [
    [3, 3],
    [16, 11],
  ],
  cities: [
    { at: [10, 3], name: 'Вельск', level: 1 },
    { at: [8, 8], name: 'Ольховка', level: 2 },
    { at: [15, 6], name: 'Сосногорск', level: 1 },
  ],
  roads: [
    [
      [3, 3],
      [10, 3],
    ],
    [
      [10, 3],
      [15, 6],
    ],
    [
      [8, 8],
      [15, 6],
    ],
    [
      [15, 6],
      [16, 11],
    ],
  ],
  rivers: [{ col: 10, from: 4, to: 8 }],
  features: [
    { at: [13, 2], type: 'mine' },
    { at: [2, 11], type: 'fertile' },
    { at: [4, 6], type: 'pass' },
  ],
};

const SMALL: HandMap = {
  id: 'small',
  rows: [
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~.....ff........~~~~.....hh.......~~~~',
    '~~.....ffff.......~~~.....hhhh.......~~~',
    '~.......fff........~.....hhmmh........~~',
    '~.......................hmmmh.........~~',
    '~...dd..........ff......hmmh....ff.....~',
    '~..dddd........ffff......hh....ffff....~',
    '~..ddd..........ff.............fff.....~',
    '~.......hh..............~~.............~',
    '~......hhhh...........~~~~......dd.....~',
    '~.......hh...........~~~~~.....dddd....~',
    '~....................~~~~.......dd.....~',
    '~~.......ff...........~~..............~~',
    '~~......ffff......mm..........hh......~~',
    '~~.......ff......mmmm........hhhh.....~~',
    '~~..............mmmm..........hh......~~',
    '~.................mm..................~~',
    '~.....hh.......................ff.....~~',
    '~....hhhh.........ff..........ffff.....~',
    '~.....hh.........ffff..........ff......~',
    '~.................ff...................~',
    '~..ff.....~~~.................dd.......~',
    '~.ffff...~~~~~...........hh..dddd......~',
    '~..ff.....~~~...........hhhh..dd.......~',
    '~........................hh............~',
    '~~...........ff.....................~~~~',
    '~~~.........ffff.........ff........~~~~~',
    '~~~~.........ff.........ffff......~~~~~~',
    '~~~~~~.................~~ff~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  ],
  spawns: [
    [5, 3],
    [20, 5],
    [34, 3],
    [5, 19],
    [22, 22],
    [34, 19],
  ],
  cities: [
    { at: [12, 6], name: 'Вельск', level: 1 },
    { at: [28, 7], name: 'Ольховка', level: 2 },
    { at: [3, 11], name: 'Сосногорск', level: 1 },
    { at: [13, 13], name: 'Каменка', level: 3 },
    { at: [27, 13], name: 'Липецово', level: 1 },
    { at: [36, 12], name: 'Дубрава', level: 2 },
    { at: [13, 21], name: 'Заречье', level: 1 },
    { at: [28, 25], name: 'Береговое', level: 2 },
    { at: [7, 26], name: 'Ясногорье', level: 1 },
  ],
  roads: [
    [
      [5, 3],
      [12, 6],
    ],
    [
      [12, 6],
      [20, 5],
    ],
    [
      [20, 5],
      [28, 7],
    ],
    [
      [28, 7],
      [34, 3],
    ],
    [
      [12, 6],
      [13, 13],
    ],
    [
      [3, 11],
      [13, 13],
    ],
    [
      [28, 7],
      [27, 13],
    ],
    [
      [27, 13],
      [36, 12],
    ],
    [
      [36, 12],
      [34, 19],
    ],
    [
      [13, 13],
      [15, 17],
    ],
    [
      [15, 17],
      [21, 17],
    ],
    [
      [21, 17],
      [27, 13],
    ],
    [
      [3, 11],
      [5, 19],
    ],
    [
      [5, 19],
      [9, 19],
    ],
    [
      [9, 19],
      [13, 20],
    ],
    [
      [13, 20],
      [13, 21],
    ],
    [
      [13, 21],
      [22, 22],
    ],
    [
      [22, 22],
      [28, 25],
    ],
    [
      [22, 22],
      [34, 19],
    ],
    [
      [13, 21],
      [15, 23],
    ],
    [
      [15, 23],
      [8, 25],
    ],
    [
      [8, 25],
      [7, 26],
    ],
  ],
  rivers: [
    { col: 25, from: 4, to: 7 },
    { col: 12, from: 16, to: 20 },
  ],
  features: [
    { at: [27, 4], type: 'pass' },
    { at: [8, 9], type: 'mine' },
    { at: [31, 14], type: 'mine' },
    { at: [16, 9], type: 'fertile' },
    { at: [20, 17], type: 'fertile' },
  ],
};

let failed = false;
for (const m of [TINY, SMALL]) {
  const json = toJson(m);
  const result = loadMap(json);
  if (!result.ok) {
    failed = true;
    console.error(`${m.id}:\n  ${result.errors.join('\n  ')}`);
    continue;
  }
  const file = new URL(`../maps/${m.id}.json`, import.meta.url);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${m.id}: ${json.width}×${json.height}, записано`);
}
if (failed) process.exit(1);
