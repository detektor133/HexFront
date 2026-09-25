import { describe, expect, it } from 'vitest';

import { loadMap, type PlayerView } from '@hexfront/sim';

import { roadTree } from '../src/dev/economy-layer.ts';

// Карта 3×2 без городов; гексы 0, 1, 4 попарно соседние (треугольник): все пары дали бы 3 ребра.
function view(road: number[]): { map: Parameters<typeof roadTree>[0]; v: PlayerView } {
  const size = 6;
  const loaded = loadMap({
    version: 1,
    id: 't',
    width: 3,
    height: 2,
    terrain: 'AQEBAQEB',
    features: [],
    riverEdges: [],
    roads: 'AA==',
    cities: [],
    spawns: [{ q: 1, r: 0 }],
  });
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const roadArr = new Uint8Array(size);
  for (const id of road) roadArr[id] = 1;
  const v = {
    hexes: { owner: new Int16Array(size).fill(0), road: roadArr, link: new Uint8Array(size) },
    cities: [],
  } as unknown as PlayerView;
  return { map: loaded.map, v };
}

describe('дерево дорог', () => {
  it('три взаимно соседних дорожных гекса дают 2 ребра, а не треугольник', () => {
    const { map, v } = view([0, 1, 4]);
    expect(roadTree(map, v)).toHaveLength(2);
  });
});
