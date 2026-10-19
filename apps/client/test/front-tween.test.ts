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

  it('сопоставляет переставленные куски по ближайшим концам без скачка между участками', () => {
    const from = [line(0, 0, 20), line(0, 100, 120)];
    const to = [line(20, 100, 120), line(20, 0, 20)];
    const intersects = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      c: { x: number; y: number },
      d: { x: number; y: number },
    ): boolean => {
      const cross = (
        u: { x: number; y: number },
        v: { x: number; y: number },
        w: { x: number; y: number },
      ): number => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
      const abC = cross(a, b, c);
      const abD = cross(a, b, d);
      const cdA = cross(c, d, a);
      const cdB = cross(c, d, b);
      return abC * abD < 0 && cdA * cdB < 0;
    };
    const hasIntersection = (runs: readonly (readonly { x: number; y: number }[])[]): boolean => {
      const segments = runs.flatMap((run) =>
        run.slice(1).flatMap((end, i) => {
          const start = run[i];
          return start ? ([[start, end]] as const) : [];
        }),
      );
      return segments.some(([a, b], i) =>
        segments.slice(i + 1).some(([c, d]) => intersects(a, b, c, d)),
      );
    };
    const expectedSource = [from[1] ?? [], from[0] ?? []];
    for (const p of [0.25, 0.5, 0.75]) {
      const tweened = tweenRuns(from, to, p);
      expect(hasIntersection(tweened)).toBe(false);
      for (let i = 0; i < tweened.length; i += 1) {
        const actual = tweened[i] ?? [];
        const source = expectedSource[i] ?? [];
        const target = to[i] ?? [];
        for (const [actualEnd, sourceEnd, targetEnd] of [
          [actual[0], source[0], target[0]],
          [actual.at(-1), source.at(-1), target.at(-1)],
        ] as const) {
          if (!actualEnd || !sourceEnd || !targetEnd) throw new Error('неполные концы куска');
          expect(
            Math.hypot(actualEnd.x - sourceEnd.x, actualEnd.y - sourceEnd.y),
          ).toBeLessThanOrEqual(
            Math.hypot(targetEnd.x - sourceEnd.x, targetEnd.y - sourceEnd.y) + 1e-8,
          );
        }
      }
    }
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

  it('учитывает разворот куска до выбора глобального соответствия', () => {
    const from = [
      [
        { x: 54, y: 98 },
        { x: 50, y: 57 },
      ],
      [
        { x: 1, y: 25 },
        { x: 91, y: 100 },
      ],
    ];
    const to = [
      [
        { x: 37, y: 58 },
        { x: 77, y: 89 },
      ],
      [
        { x: 24, y: 41 },
        { x: 28, y: 8 },
      ],
    ];
    const mid = tweenRuns(from, to, 0.5);

    expect(mid[0]?.[0]?.x).toBeCloseTo(43.5, 5);
    expect(mid[1]?.[0]?.x).toBeCloseTo(57.5, 5);
  });
});
