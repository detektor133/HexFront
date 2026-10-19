import { describe, expect, it } from 'vitest';

import { frontAppearance, isPointNearPath } from '../src/dev/plan-layer.ts';
import { tokens } from '../src/theme/tokens.ts';

describe('прогноз у линии наступления', () => {
  const path = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  ] as const;

  it('показывает попадание рядом с отрезком', () => {
    expect(isPointNearPath({ x: 50, y: 10 }, path, 10)).toBe(true);
  });

  it('скрывает прогноз далеко от линии', () => {
    expect(isPointNearPath({ x: 50, y: 11 }, path, 10)).toBe(false);
  });

  it('учитывает короткий отрезок и его концы', () => {
    expect(isPointNearPath({ x: -5, y: 0 }, path, 5)).toBe(true);
  });
});

describe('видимость линии фронта', () => {
  it('выделяет выбранную армию alpha=1 и соседней шириной', () => {
    const appearance = frontAppearance(7, 7, 1);

    expect(appearance.alpha).toBe(1);
    expect(appearance.width).toBe(tokens.front.width[2]);
    expect(appearance.detailShift).toBe(1);
  });

  it('приглушает остальные армии и не меняет их ширину', () => {
    const appearance = frontAppearance(7, 8, 1);

    expect(appearance.alpha).toBe(tokens.fog.memoryAlpha);
    expect(appearance.width).toBe(tokens.front.width[1]);
    expect(appearance.detailShift).toBe(0);
  });

  it('при отсутствии выбора не выделяет ни одну армию', () => {
    expect(frontAppearance(null, 7, 1).alpha).toBe(tokens.fog.memoryAlpha);
    expect(frontAppearance(null, 7, 1).width).toBe(tokens.front.width[1]);
  });
});
