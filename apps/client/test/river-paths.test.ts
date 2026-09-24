import { describe, expect, it } from 'vitest';

import { chainSegments } from '../src/render/river-paths.ts';

const p = (x: number, y: number): { x: number; y: number } => ({ x, y });

describe('цепочки рёбер рек', () => {
  it('собирает рёбра в одну ломаную независимо от порядка и направления', () => {
    const chains = chainSegments([
      [p(2, 0), p(1, 0)],
      [p(0, 0), p(1, 0)],
      [p(2, 0), p(3, 1)],
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toHaveLength(4);
    const xs = chains[0]?.map((q) => q.x) ?? [];
    expect([xs[0], xs.at(-1)].sort()).toEqual([0, 3]);
  });

  it('раздельные реки дают раздельные цепочки', () => {
    expect(
      chainSegments([
        [p(0, 0), p(1, 0)],
        [p(5, 5), p(6, 5)],
      ]),
    ).toHaveLength(2);
  });

  it('считает совпадающими вершины с погрешностью float', () => {
    expect(
      chainSegments([
        [p(0, 0), p(0.1 + 0.2, 0)],
        [p(0.3, 0), p(1, 0)],
      ]),
    ).toHaveLength(1);
  });
});
