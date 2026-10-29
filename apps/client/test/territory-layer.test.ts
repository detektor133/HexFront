import { Graphics, Text } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { loadMap, type PlayerView } from '@hexfront/sim';

import {
  borderMapChunks,
  changedMapChunks,
  createEconomyLayer,
  fogHexes,
  mapChunkKey,
  territoryBorders,
} from '../src/dev/economy-layer.ts';
import { playerLine } from '../src/theme/colors.ts';
import { tokens } from '../src/theme/tokens.ts';

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
      pop: new Int32Array(2),
      improvement: new Uint8Array(2),
      building: new Uint8Array(2),
      road: new Uint8Array(2),
      link: new Uint8Array(2),
      growth: new Int32Array(2),
    },
    cities: [],
    constructions: [],
    plans: [],
    players: [],
  }) as unknown as PlayerView;

const labelMapResult = loadMap({
  version: 1,
  id: 'territory-label-test',
  width: 2,
  height: 2,
  terrain: 'AQEBAQ==',
  features: [],
  riverEdges: [],
  roads: 'AA==',
  cities: [],
  spawns: [{ q: 0, r: 0 }],
});
if (!labelMapResult.ok) throw new Error(labelMapResult.errors.join('; '));

const labelView = (owner: number[]): PlayerView =>
  ({
    playerId: 0,
    hexes: {
      owner: Int16Array.from(owner),
      visible: Uint8Array.from(owner.map(() => 1)),
      pop: new Int32Array(owner.length),
      improvement: new Uint8Array(owner.length),
      building: new Uint8Array(owner.length),
      road: new Uint8Array(owner.length),
      link: new Uint8Array(owner.length),
      growth: new Int32Array(owner.length),
    },
    cities: [],
    constructions: [],
    plans: [],
    players: [
      { id: 0, name: 'Север' },
      { id: 1, name: 'Юг' },
    ],
  }) as unknown as PlayerView;

describe('слои границ и тумана', () => {
  it('инвалидирует только чанк изменившегося гекса', () => {
    expect(mapChunkKey(17, 32)).toBe('1:0');
    expect(changedMapChunks([0, 17, 17], 32)).toEqual(['0:0', '1:0']);
  });

  it('инвалидирует соседний чанк для общей границы', () => {
    expect(borderMapChunks([15], 32, 16)).toEqual(['0:0', '1:0']);
  });

  it('рисует общую границу цветом каждого владельца с его стороны', () => {
    const borders = territoryBorders(loaded.map, view([1, 1]));

    expect(borders.filter((edge) => edge.neighborOwner >= 0)).toHaveLength(2);
    expect(new Set(borders.map((edge) => edge.owner))).toEqual(new Set([0, 1]));
  });

  it('рисует границу толщиной 1,5 экранных px на каждом detail и сохраняет оба цвета соседей', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
    const layer = createEconomyLayer(loaded.map, 10);
    const strokes = vi.spyOn(Graphics.prototype, 'stroke');
    const selection = { hex: null, units: [], target: null };
    try {
      for (const detail of [1, 2, 3] as const) {
        strokes.mockClear();
        layer.update(detail, detail);
        layer.setView(view([1, 1]), selection);

        const borderStrokes = strokes.mock.calls
          .map(([style]) => style)
          .filter(
            (style): style is { width: number; color: string } =>
              typeof style === 'object' &&
              style !== null &&
              'width' in style &&
              typeof style.width === 'number' &&
              'color' in style &&
              typeof style.color === 'string' &&
              style.width * detail === tokens.territory.borderWidth[0] &&
              [playerLine(0), playerLine(1)].includes(style.color),
          );
        expect(borderStrokes.length).toBeGreaterThanOrEqual(2);
        expect(new Set(borderStrokes.map((style) => style.color))).toEqual(
          new Set([playerLine(0), playerLine(1)]),
        );
      }
    } finally {
      strokes.mockRestore();
      layer.destroy();
    }
  });

  it('штрихует только гексы вне зоны обзора', () => {
    expect(fogHexes(view([1, 0]))).toEqual([1]);
    expect(fogHexes(view([1, 1]))).toEqual([]);
  });

  it('показывает подписи на detail 1 и 2 и скрывает на detail 3 через setView', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
    const layer = createEconomyLayer(labelMapResult.map, 10);
    try {
      layer.update(1, 1);
      layer.setView(labelView([0, 0, 1, -1]), { hex: null, units: [], target: null });
      expect(
        layer.territoryLabels.children.map((child) => (child instanceof Text ? child.text : null)),
      ).toEqual(['Север', 'Юг']);

      layer.update(1, 2);
      expect(
        layer.territoryLabels.children.map((child) => (child instanceof Text ? child.text : null)),
      ).toEqual(['Север', 'Юг']);
      layer.update(1, 3);
      expect(layer.territoryLabels.children).toHaveLength(0);
    } finally {
      layer.destroy();
    }
  });
});
