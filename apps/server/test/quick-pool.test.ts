import { describe, expect, it } from 'vitest';

import { pickQuickMap } from '../src/maps.ts';

describe('пул карт быстрого боя', () => {
  it('за разные зёрна встречаются и случайная карта, и готовые; игроков не больше стартов', () => {
    const names = new Set<string>();
    for (let seed = 0; seed < 22; seed += 1) {
      const pick = pickQuickMap(seed, 30);
      names.add(pick.name);
      expect(pick.size).toBeGreaterThanOrEqual(2);
      expect(pick.size).toBeLessThanOrEqual(pick.map.spawns.length);
      expect(pick.name).not.toBe('tiny');
    }
    expect(names.has('gen')).toBe(true);
    expect(names.size).toBeGreaterThan(5);
  });

  it('одно зерно — одна и та же карта', () => {
    expect(pickQuickMap(7, 30).name).toBe(pickQuickMap(7, 30).name);
  });
});
