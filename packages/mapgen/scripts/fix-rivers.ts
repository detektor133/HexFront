// Чинит реки готовой карты: рёбра, записанные между соседними гексами пути реки, не стыковались в
// углах и распадались на отдельные грани. Путь по гексам восстанавливается из рёбер и
// превращается в непрерывную цепочку граней (`riverFromHexPath`).
// Запуск: node --experimental-strip-types scripts/fix-rivers.ts maps/europe.json
import { readFileSync, writeFileSync } from 'node:fs';

import { inBounds, neighbor, type Direction, type Hex } from '@hexfront/sim';

import { riverFromHexPath } from '../src/rivers.ts';

const file = process.argv[2];
if (!file) throw new Error('нужен путь к карте');
const map = JSON.parse(readFileSync(file, 'utf8')) as {
  width: number;
  height: number;
  riverEdges: [number, number, number][];
};

const key = (h: Hex): string => `${h.q},${h.r}`;
const adjacency = new Map<string, { hex: Hex; to: Set<string> }>();
const link = (a: Hex, b: Hex): void => {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const node = adjacency.get(key(x)) ?? { hex: x, to: new Set<string>() };
    node.to.add(key(y));
    adjacency.set(key(x), node);
  }
};
for (const [q, r, d] of map.riverEdges) {
  const a = { q, r };
  link(a, neighbor(a, d as Direction));
}

// Тропы: от узлов степени ≠ 2 по непройденным рёбрам; циклы добираются после.
const used = new Set<string>();
const edgeId = (a: string, b: string): string => (a < b ? `${a}>${b}` : `${b}>${a}`);
const trails: Hex[][] = [];
const walk = (start: string): void => {
  for (const first of adjacency.get(start)?.to ?? []) {
    if (used.has(edgeId(start, first))) continue;
    const trail: Hex[] = [(adjacency.get(start) as { hex: Hex }).hex];
    let from = start;
    let at = first;
    for (;;) {
      used.add(edgeId(from, at));
      trail.push((adjacency.get(at) as { hex: Hex }).hex);
      const open = [...(adjacency.get(at)?.to ?? [])].filter((n) => !used.has(edgeId(at, n)));
      if (adjacency.get(at)?.to.size !== 2 || open.length !== 1) break;
      from = at;
      at = open[0] as string;
    }
    trails.push(trail);
  }
};
for (const [k, node] of adjacency) if (node.to.size !== 2) walk(k);
for (const k of adjacency.keys()) walk(k);

const seen = new Set<string>();
const edges: [number, number, number][] = [];
for (const trail of trails) {
  for (const e of riverFromHexPath(trail, (h) => inBounds(h, map.width, map.height))) {
    const id = e.join(',');
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push(e);
  }
}
map.riverEdges = edges;
writeFileSync(file, `${JSON.stringify(map)}\n`);
console.log(
  `${file}: путей ${trails.length}, граней было ${adjacency.size}, стало ${edges.length}`,
);
