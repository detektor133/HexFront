import { describe, expect, it } from 'vitest';

import { loadMap, type PlayerView } from '@hexfront/sim';

import { fogHexes, territoryBorders } from '../src/dev/economy-layer.ts';

const loaded = loadMap({
  version: 1,
  id: 'territory-test',
  width: 2,
  height: 1,
  terrain: 'AQE=',
  features: [],
  riverEdges: [],
  roads: 'AA==',
  cities: [],
  spawns: [{ q: 0, r: 0 }],
});
if (!loaded.ok) throw new Error(loaded.errors.join('; '));

const view = (visible: number[]): PlayerView =>
  ({
    playerId: 0,
    hexes: {
      owner: Int16Array.from([0, 1]),
      visible: Uint8Array.from(visible),
    },
  }) as unknown as PlayerView;

describe('слои границ и тумана', () => {
  it('рисует общую границу цветом каждого владельца с его стороны', () => {
    const borders = territoryBorders(loaded.map, view([1, 1]));

    expect(borders.filter((edge) => edge.neighborOwner >= 0)).toHaveLength(2);
    expect(new Set(borders.map((edge) => edge.owner))).toEqual(new Set([0, 1]));
  });

  it('штрихует только гексы вне зоны обзора', () => {
    expect(fogHexes(view([1, 0]))).toEqual([1]);
    expect(fogHexes(view([1, 1]))).toEqual([]);
  });
});
