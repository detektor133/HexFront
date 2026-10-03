// Генерирует фиксированную карту 80×50 для замеров рендера (04/T12): 4000 проходимых гексов.
import { writeFileSync } from 'node:fs';

import { encodeBase64, offsetToAxial, packBits, TERRAIN, type MapJson } from '@hexfront/sim';

const WIDTH = 80;
const HEIGHT = 50;
const SIZE = WIDTH * HEIGHT;

const spawns = Array.from({ length: 30 }, (_, i) =>
  offsetToAxial({ col: 5 + (i % 6) * 13, row: 5 + Math.floor(i / 6) * 9 }),
);
const map: MapJson = {
  version: 1,
  id: 'perf-4000',
  width: WIDTH,
  height: HEIGHT,
  terrain: encodeBase64(new Uint8Array(SIZE).fill(TERRAIN.plains)),
  features: [],
  riverEdges: [],
  roads: encodeBase64(packBits(new Uint8Array(SIZE))),
  cities: [],
  spawns,
};

writeFileSync(
  new URL('../../../packages/mapgen/maps/perf-4000.json', import.meta.url),
  `${JSON.stringify(map)}\n`,
);
