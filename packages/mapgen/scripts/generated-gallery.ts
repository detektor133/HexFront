import { writeFileSync } from 'node:fs';

import { decodeBase64, hexId } from '@hexfront/sim';

import { generateMap } from '../src/index.ts';

const GLYPHS: readonly string[] = ['~', '.', 'f', 'h', 'm', 'd'];
const width = 80;
const height = 60;
const players = 30;

function preview(seed: number): string {
  const map = generateMap(seed, { width, height, players });
  const terrain = decodeBase64(map.terrain);
  if (!terrain) throw new Error(`сид ${seed}: битый terrain`);
  const cities = new Set(map.cities.map((city) => hexId(city, map.width)));
  const spawns = new Set(map.spawns.map((spawn) => hexId(spawn, map.width)));
  const rows: string[] = [];
  for (let row = 0; row < height; row += 2) {
    let line = '';
    for (let col = 0; col < width; col += 2) {
      const id = col + row * width;
      const glyph = cities.has(id) ? 'C' : spawns.has(id) ? 'S' : (GLYPHS[terrain[id] ?? 0] ?? '?');
      line += glyph;
    }
    rows.push(line);
  }
  return rows.join('\n');
}

const output = [
  '# Галерея процедурных карт',
  '',
  'Масштаб превью: 2×2 гекса на символ; `C` — город, `S` — спавн.',
  '',
];
for (let seed = 42; seed < 54; seed += 1) {
  output.push(`## Сид ${seed}`, '', '```text', preview(seed), '```', '');
}
writeFileSync(
  new URL('../../../docs/reports/stage-05-mapgen.md', import.meta.url),
  `${output.join('\n')}\n`,
);
