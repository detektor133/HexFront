import { describe, expect, it } from 'vitest';

import { loadMap, type PlayerView } from '@hexfront/sim';

import { roadEdgeOwner, roadTree } from '../src/dev/economy-layer.ts';

// Карта 3×2 без городов; гексы 0, 1, 4 попарно соседние (треугольник): все пары дали бы 3 ребра.
function view(
  road: number[],
  owner: number[] = [0, 0, 0, 0, 0, 0],
  link: number[] = [0, 0, 0, 0, 0, 0],
): { map: Parameters<typeof roadTree>[0]; v: PlayerView } {
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
    hexes: { owner: Int16Array.from(owner), road: roadArr, link: Uint8Array.from(link) },
    cities: [],
  } as unknown as PlayerView;
  return { map: loaded.map, v };
}

describe('дерево дорог', () => {
  it('три взаимно соседних дорожных гекса дают 2 ребра, а не треугольник', () => {
    const { map, v } = view([0, 1, 4]);
    expect(roadTree(map, v)).toHaveLength(2);
  });

  it('дорога через границу владельцев не рвётся: связь есть при любых владельцах', () => {
    const { map, v } = view([0, 1], [0, 1, 0, 0, 0, 0]);
    expect(roadTree(map, v)).toEqual([[0, 1]]);
  });

  it('цвет владельца — только у отрезка со снабжением, остальное серое', () => {
    // LINK: 1 — основная сеть, 2 — изолированная.
    const supplied = view([0, 1], [0, 0, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0]).v;
    expect(roadEdgeOwner(supplied, 0, 1)).toBe(0);
    const border = view([0, 1], [0, 1, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0]).v;
    expect(roadEdgeOwner(border, 0, 1)).toBeNull();
    const isolated = view([0, 1], [0, 0, 0, 0, 0, 0], [2, 2, 0, 0, 0, 0]).v;
    expect(roadEdgeOwner(isolated, 0, 1)).toBeNull();
    const neutral = view([0, 1], [-1, -1, 0, 0, 0, 0]).v;
    expect(roadEdgeOwner(neutral, 0, 1)).toBeNull();
  });
});
