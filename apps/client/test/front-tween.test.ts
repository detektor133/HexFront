import { describe, expect, it } from 'vitest';

import { createFrontTweens, easeMap, tweenRuns } from '../src/dev/front-tween.ts';

// 04/T13: линия фронта переходит в новое положение плавно, за 250 мс (style-guide, «Движение»).

const line = (y: number, x0: number, x1: number): { x: number; y: number }[] => [
  { x: x0, y },
  { x: (x0 + x1) / 2, y },
  { x: x1, y },
];

describe('плавный переход линии фронта (04/T13)', () => {
  it('кривая: 0 → 0, 1 → 1, монотонна и быстрее линейной в начале (выход)', () => {
    expect(easeMap(0)).toBeCloseTo(0, 5);
    expect(easeMap(1)).toBeCloseTo(1, 5);
    let prev = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const v = easeMap(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(easeMap(0.25)).toBeGreaterThan(0.25);
  });

  it('в начале — прежняя линия, в конце — новая, посередине — между ними', () => {
    const from = [line(0, 0, 100)];
    const to = [line(40, 0, 100)];
    const start = tweenRuns(from, to, 0)[0] ?? [];
    const end = tweenRuns(from, to, 1)[0] ?? [];
    expect(start.every((p) => Math.abs(p.y) < 1e-9)).toBe(true);
    expect(end.every((p) => Math.abs(p.y - 40) < 1e-9)).toBe(true);
    const mid = tweenRuns(from, to, 0.5)[0] ?? [];
    expect(mid.every((p) => p.y > 0 && p.y < 40)).toBe(true);
  });

  it('линия другой длины и в обратном порядке точек не перекручивается', () => {
    const from = [line(0, 0, 100)];
    const to = [[...line(20, 0, 160)].reverse()];
    const mid = tweenRuns(from, to, 0.5)[0] ?? [];
    // Начало новой линии (x = 160) приходит от ближнего конца прежней (x = 100), а не через всю
    // линию от x = 0 (тогда посередине было бы 80).
    expect(mid[0]?.x ?? NaN).toBeCloseTo(130, 5);
    const end = tweenRuns(from, to, 1)[0] ?? [];
    expect(end[0]?.x ?? NaN).toBeCloseTo(160, 5);
    expect(end.at(-1)?.x ?? NaN).toBeCloseTo(0, 5);
  });

  it('разное число кусков — сразу новая линия, без пропаданий', () => {
    const from = [line(0, 0, 50)];
    const to = [line(10, 0, 40), line(10, 60, 100)];
    expect(tweenRuns(from, to, 0.3)).toEqual(to);
  });

  it('удаляет армии без фронта и сообщает размер кэша', () => {
    const tweens = createFrontTweens(false);
    const target = [line(0, 0, 100)];

    tweens.runs(1, 'front-1', target, 0);
    tweens.runs(2, 'front-2', target, 0);
    expect(tweens.cacheTelemetry()).toEqual({ byArmy: 2 });

    tweens.keep(new Set([1]));
    expect(tweens.cacheTelemetry()).toEqual({ byArmy: 1 });
  });
});
