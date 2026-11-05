import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { neighbor, type Direction, type Hex } from '@hexfront/sim';

import { generateTerrain } from '../src/index.ts';

const key = (h: Hex): string => `${h.q},${h.r}`;

// Доля граней реки, не касающихся ни одной другой грани, — «обрывки», которые не читаются рекой.
function isolatedShare(edges: readonly (readonly [number, number, number])[]): number {
  const corners = new Map<string, number>();
  const ends = edges.map(([q, r, d]) => {
    const a = { q, r };
    const b = neighbor(a, d as Direction);
    const c1 = neighbor(a, ((d + 1) % 6) as Direction);
    const c2 = neighbor(a, ((d + 5) % 6) as Direction);
    const k1 = [key(a), key(b), key(c1)].sort().join('|');
    const k2 = [key(a), key(b), key(c2)].sort().join('|');
    corners.set(k1, (corners.get(k1) ?? 0) + 1);
    corners.set(k2, (corners.get(k2) ?? 0) + 1);
    return [k1, k2] as const;
  });
  const alone = ends.filter(
    ([k1, k2]) => (corners.get(k1) ?? 0) === 1 && (corners.get(k2) ?? 0) === 1,
  );
  return edges.length === 0 ? 0 : alone.length / edges.length;
}

describe('реки — непрерывные цепочки граней', () => {
  it('случайная карта: реки не распадаются на отдельные грани', () => {
    for (const seed of [1, 7, 42, 99]) {
      const { riverEdges } = generateTerrain(seed, { width: 80, height: 60, players: 12 });
      expect(isolatedShare(riverEdges), `сид ${seed}`).toBeLessThan(0.05);
    }
  });

  it('карта Европы: обрывков не больше нескольких процентов', () => {
    const europe = JSON.parse(
      readFileSync(new URL('../maps/europe.json', import.meta.url), 'utf8'),
    ) as { riverEdges: [number, number, number][] };
    expect(isolatedShare(europe.riverEdges)).toBeLessThan(0.05);
  });
});
