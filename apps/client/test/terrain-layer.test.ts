import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { detailLevel } from '../src/render/camera.ts';
import { createTerrainLayer } from '../src/render/terrain-layer.ts';
import { tokens } from '../src/theme/tokens.ts';

const loaded = loadMap({
  version: 1,
  id: 'terrain-test',
  width: 3,
  height: 2,
  terrain: 'AQEBAQEB',
  features: [],
  riverEdges: [],
  roads: 'AA==',
  cities: [],
  spawns: [{ q: 1, r: 0 }],
});
if (!loaded.ok) throw new Error(loaded.errors.join('; '));

describe('слои рельефа карты', () => {
  it('разделяет базовые заливки и узоры слоем территории между ними', () => {
    const layer = createTerrainLayer(loaded.map, tokens.map.hexRadius);

    expect(layer.base.children).toHaveLength(3);
    expect(layer.overlay.children).toHaveLength(3);
    const mapViewSource = readFileSync(
      new URL('../src/render/map-view.ts', import.meta.url),
      'utf8',
    );
    expect(mapViewSource).toMatch(
      /const mount = \(\): void => \{\s*world\.addChild\(layer\.base\);[\s\S]*?world\.addChild\(layer\.overlay\);/u,
    );
    expect(detailLevel(0.5)).toBe(1);
    expect(detailLevel(1)).toBe(2);
    expect(detailLevel(2)).toBe(3);

    layer.update(0.5, 1);
    layer.update(1, 2);
    layer.update(2, 3);
    layer.destroy();
  });
});
