import { Text } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap, type PlayerView } from '@hexfront/sim';

import { installTextCanvasStub } from './text-canvas.ts';
import { createEconomyLayer } from '../src/dev/economy-layer.ts';
import { buildTerritoryLabels } from '../src/dev/territory-labels.ts';
import { packTerritory } from '../src/render/territory-gpu.ts';

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

const cacheLabelMapResult = loadMap({
  version: 1,
  id: 'territory-label-cache-test',
  width: 3,
  height: 3,
  terrain: 'AQEBAQEBAQEB',
  features: [],
  riverEdges: [],
  roads: 'AAA=',
  cities: [],
  spawns: [{ q: 0, r: 0 }],
});
if (!cacheLabelMapResult.ok) throw new Error(cacheLabelMapResult.errors.join('; '));

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
    units: [],
    armies: [],
    recruits: [],
    players: [
      { id: 0, name: 'Север' },
      { id: 1, name: 'Юг' },
    ],
  }) as unknown as PlayerView;

describe('территория на GPU и подписи', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('пакует владельца и видимость гексов в текстуру для шейдера', () => {
    const data = new Uint8Array(2 * 4);

    expect(packTerritory(view([1, 0]), data)).toBe(true);
    expect(Array.from(data)).toEqual([1, 255, 0, 255, 2, 0, 0, 255]);
  });

  it('сообщает об изменении только когда данные текстуры поменялись', () => {
    const data = new Uint8Array(2 * 4);
    packTerritory(view([1, 1]), data);

    expect(packTerritory(view([1, 1]), data)).toBe(false);
    expect(packTerritory(view([1, 0]), data)).toBe(true);
  });

  it('показывает подписи на detail 1 и 2 и скрывает на detail 3 через setView', () => {
    installTextCanvasStub();
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

  it('пересоздаёт подпись при расширении территории через setView', () => {
    installTextCanvasStub();
    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
    const layer = createEconomyLayer(labelMapResult.map, 10);
    const selection = { hex: null, units: [], target: null };
    try {
      layer.update(1, 1);
      layer.setView(labelView([0, -1, -1, 0]), selection);
      const previous = layer.territoryLabels.children[0];
      expect(previous).toBeInstanceOf(Text);
      const previousPosition = previous instanceof Text ? { x: previous.x, y: previous.y } : null;

      layer.setView(labelView([0, 0, 0, 0]), selection);
      const updated = layer.territoryLabels.children[0];
      expect(updated).toBeInstanceOf(Text);
      expect(updated).not.toBe(previous);
      expect(updated instanceof Text ? updated.text : '').toBe('Север');
      expect(updated instanceof Text ? { x: updated.x, y: updated.y } : null).toEqual(
        previousPosition,
      );
    } finally {
      layer.destroy();
    }
  });

  it('обновляет подпись через setView при изменении ширины с прежними центром и кеглем', () => {
    installTextCanvasStub();
    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
    const selection = { hex: null, units: [], target: null };
    const narrowLabels = buildTerritoryLabels(
      labelView([-1, 0, -1, -1, 0, -1, -1, 0, -1]),
      cacheLabelMapResult.map.width,
      10,
    );
    const wideLabels = buildTerritoryLabels(
      labelView([0, 0, -1, -1, -1, -1, -1, -1, 0]),
      cacheLabelMapResult.map.width,
      10,
    );
    expect(narrowLabels[0]?.fontSize).toBe(wideLabels[0]?.fontSize);
    expect(narrowLabels[0]?.at).toEqual(wideLabels[0]?.at);
    expect(narrowLabels[0]?.maxWidth).toBeLessThan(wideLabels[0]?.maxWidth ?? 0);
    const layer = createEconomyLayer(cacheLabelMapResult.map, 10);
    try {
      layer.update(1, 1);
      layer.setView(labelView([-1, 0, -1, -1, 0, -1, -1, 0, -1]), selection);
      const previous = layer.territoryLabels.children[0];
      expect(previous).toBeInstanceOf(Text);
      if (!(previous instanceof Text)) throw new Error('Подпись первой территории не создана');
      const previousPosition = { x: previous.x, y: previous.y };
      const previousWidth = previous.width;

      layer.setView(labelView([0, 0, -1, -1, -1, -1, -1, -1, 0]), selection);
      const updated = layer.territoryLabels.children[0];
      expect(updated).toBeInstanceOf(Text);
      if (!(updated instanceof Text)) throw new Error('Подпись второй территории не создана');

      expect({ x: updated.x, y: updated.y }).toEqual(previousPosition);
      expect(updated.width).toBeGreaterThan(previousWidth);
    } finally {
      layer.destroy();
    }
  });
});
