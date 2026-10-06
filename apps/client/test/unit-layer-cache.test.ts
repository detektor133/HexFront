import { describe, expect, it } from 'vitest';

import { pruneUnitLayerCaches, unitLayerCacheTelemetry } from '../src/dev/unit-layer.ts';

describe('кэши слоя отрядов', () => {
  it('удаляет позиции отрядов и фишек, которых нет в новом снимке', () => {
    const shown = new Map([
      [1, { x: 1, y: 1 }],
      [2, { x: 2, y: 2 }],
    ]);
    const drawnAt = new Map([
      ['h1', { x: 1, y: 1 }],
      ['h2', { x: 2, y: 2 }],
    ]);
    const chips = new Map([
      ['h1', {}],
      ['h2', {}],
    ]);
    const encircledSince = new Map([
      [1, 10],
      [2, 10],
    ]);

    pruneUnitLayerCaches(shown, drawnAt, chips, encircledSince, new Set([2]), new Set(['h2']));

    expect([...shown.keys()]).toEqual([2]);
    expect([...drawnAt.keys()]).toEqual(['h2']);
    expect([...chips.keys()]).toEqual(['h2']);
    expect([...encircledSince.keys()]).toEqual([2]);
    expect(unitLayerCacheTelemetry(shown, drawnAt, chips, encircledSince)).toEqual({
      shown: 1,
      drawnAt: 1,
      chips: 1,
      encircledSince: 1,
    });
  });
});
