import { describe, expect, it } from 'vitest';

import { economyLayerCacheTelemetry, pruneEconomyLayerCaches } from '../src/dev/economy-layer.ts';

describe('кэши слоя экономики', () => {
  it('удаляет эффекты гексов и городов, которых нет в снимке', () => {
    const capturesByHex = new Map([
      [1, 'active'],
      [8, 'stale'],
    ]);
    const cityFlashes = new Map([
      [3, 'active'],
      [9, 'stale'],
    ]);

    pruneEconomyLayerCaches(capturesByHex, cityFlashes, new Set([1, 2]), new Set([3, 4]));

    expect([...capturesByHex.keys()]).toEqual([1]);
    expect([...cityFlashes.keys()]).toEqual([3]);
  });

  it('возвращает размеры обоих кэшей для телеметрии', () => {
    const capturesByHex = new Map([
      [1, 'active'],
      [2, 'active'],
    ]);
    const cityFlashes = new Map([[3, 'active']]);

    expect(economyLayerCacheTelemetry(capturesByHex, cityFlashes)).toEqual({
      capturesByHex: 2,
      cityFlashes: 1,
    });
  });
});
