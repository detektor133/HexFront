import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { edgeHex, edgeOf, edgeOther, loadMap, type EdgeId } from '@hexfront/sim';

import {
  arrowCount,
  arrowPairs,
  arrowShape,
  offensiveArrows,
  offensiveCurve,
} from '../src/dev/plan-arrows.ts';
import { edgeMid, edgeRuns } from '../src/dev/plan-edges.ts';
import type { Point } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);
const R = tokens.map.hexRadius;
const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const map = loaded.map;

// Прямая граница между строками 10 и 11 (гексы с плоской вершиной: грани идут «волной»).
function rowBorder(from: number, count: number): EdgeId[] {
  const row = 10;
  const out: EdgeId[] = [];
  for (let col = from; col < from + count; col += 1) {
    const h = col + row * map.width;
    for (let d = 0; d < 6; d += 1) {
      const n = edgeOther({ map, hexes: { owner: new Int16Array(0) } }, edgeOf(h, d));
      if (n >= 0 && Math.floor(n / map.width) === row + 1) out.push(edgeOf(h, d));
    }
  }
  // Грани — по порядку слева направо.
  return out.sort((a, b) => edgeMid(map, R, a).x - edgeMid(map, R, b).x);
}

const turn = (a: Point, b: Point, c: Point): number => {
  const u = Math.atan2(b.y - a.y, b.x - a.x);
  const v = Math.atan2(c.y - b.y, c.x - b.x);
  const d = Math.abs(v - u);
  return Math.min(d, 2 * Math.PI - d);
};

function cross(p: Point, q: Point, r: Point, s: Point): boolean {
  const o = (a: Point, b: Point, c: Point): number =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0;
}

function onRuns(p: Point, runs: readonly Point[][]): boolean {
  return runs.some((r) =>
    r.slice(1).some((b, i) => {
      const a = r[i] as Point;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 1e-6;
    }),
  );
}

describe('кривая линии наступления (04/T14)', () => {
  it('на прямой границе из ≥ 6 граней кривая отклоняется от прямой не больше 3 px при R = 20', () => {
    expect(R).toBe(20);
    const edges = rowBorder(4, 6);
    expect(edges.length).toBeGreaterThanOrEqual(6);
    const [run] = edgeRuns(map, R, edges);
    expect(edgeRuns(map, R, edges)).toHaveLength(1);
    const curve = offensiveCurve(run ?? []);
    // Концы — на концах линии.
    expect(curve[0]).toEqual(run?.[0]);
    expect(curve.at(-1)).toEqual(run?.at(-1));
    // Граница между строками горизонтальна: прямая — посередине между уровнями её углов;
    // отклонение меряется вне крайних граней: концы стоят в углах гексов, а угол и середина
    // крайней грани — до 8,7 px от прямой.
    const ys = (run ?? []).map((p) => p.y);
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    const mids = edges.map((e) => edgeMid(map, R, e));
    const lo = (mids[1] as Point).x;
    const hi = (mids.at(-2) as Point).x;
    const inner = curve.filter((p) => p.x >= lo && p.x <= hi);
    expect(inner.length).toBeGreaterThan(10);
    const dev = Math.max(...inner.map((p) => Math.abs(p.y - mid)));
    expect(dev).toBeLessThanOrEqual(3);
    // Середины граней сами идут волной больше 3 px — поэтому кривая их сглаживает.
    expect(Math.max(...mids.map((p) => Math.abs(p.y - mid)))).toBeGreaterThan(3);
  });

  it('на повороте нет изломов: соседние отрезки кривой поворачивают не больше чем на 20°', () => {
    // Обход трёх граней одного гекса: два поворота по 60°.
    const h = 10 + 10 * map.width;
    const edges = [0, 1, 2].map((d) => edgeOf(h, d));
    expect(edges.every((e) => edgeHex(e) === h)).toBe(true);
    const [run] = edgeRuns(map, R, edges);
    const curve = offensiveCurve(run ?? []);
    for (let i = 2; i < curve.length; i += 1) {
      const a = curve[i - 2] as Point;
      const b = curve[i - 1] as Point;
      const c = curve[i] as Point;
      expect(turn(a, b, c)).toBeLessThanOrEqual((20 * Math.PI) / 180);
    }
  });
});

describe('стрелки наступления по кускам (04/T14)', () => {
  // Фронт — вертикаль x = 0; линия — два куска справа, перечисленные снизу вверх.
  const front: Point[][] = [
    [
      { x: 0, y: 0 },
      { x: 0, y: 300 },
    ],
  ];
  const line: Point[][] = [
    [
      { x: 200, y: 300 },
      { x: 200, y: 200 },
    ],
    [
      { x: 200, y: 100 },
      { x: 200, y: 0 },
    ],
  ];

  it('стрелки не пересекаются на линии из двух кусков, концы — на кусках, не в разрыве', () => {
    for (const n of [1, 2, 3]) {
      const pairs = arrowPairs(front, line, n);
      expect(pairs).toHaveLength(n);
      for (const [from, to] of pairs) {
        expect(onRuns(from, front)).toBe(true);
        expect(onRuns(to, line)).toBe(true);
      }
      for (let i = 0; i < pairs.length; i += 1) {
        for (let j = i + 1; j < pairs.length; j += 1) {
          const [a, b] = pairs[i] as [Point, Point];
          const [c, d] = pairs[j] as [Point, Point];
          expect(cross(a, b, c, d)).toBe(false);
        }
      }
    }
  });

  it('фронт из двух кусков: начала стрелок — на кусках фронта', () => {
    const split: Point[][] = [
      [
        { x: 0, y: 0 },
        { x: 0, y: 120 },
      ],
      [
        { x: 0, y: 180 },
        { x: 0, y: 300 },
      ],
    ];
    const pairs = arrowPairs(split, line, 3);
    for (const [from] of pairs) expect(onRuns(from, split)).toBe(true);
  });
});

describe('стрелки наступления по смотрящему участку (04/T14b)', () => {
  it('число стрелок = clamp(округл(ширина смотрящего участка в гексах / 4), 1, 3)', () => {
    expect([0, 1, 2, 5, 6, 9, 10, 14, 40].map(arrowCount)).toEqual([1, 1, 1, 1, 2, 2, 3, 3, 3]);
  });

  const pt = fc.record({
    x: fc.integer({ min: -300, max: 300 }),
    y: fc.integer({ min: -300, max: 300 }),
  });
  const run = fc.array(pt, { minLength: 2, maxLength: 6 });
  const runs = fc.array(run, { minLength: 1, maxLength: 3 });

  it('для любых фронта и линии стрелки попарно не пересекаются, хвост — на смотрящем участке', () => {
    fc.assert(
      fc.property(runs, runs, fc.integer({ min: 1, max: 3 }), (front, line, n) => {
        const pairs = offensiveArrows(front, line, n);
        expect(pairs).toHaveLength(n);
        for (const [from, to] of pairs) {
          expect(onRuns(from, front)).toBe(true);
          expect(onRuns(to, line)).toBe(true);
        }
        for (let i = 0; i < pairs.length; i += 1) {
          for (let j = i + 1; j < pairs.length; j += 1) {
            const [a, b] = pairs[i] as [Point, Point];
            const [c, d] = pairs[j] as [Point, Point];
            expect(cross(a, b, c, d)).toBe(false);
          }
        }
      }),
      { numRuns: 500, seed: 11 },
    );
  });
});

describe('контур стрелки (04/T14b)', () => {
  const size = tokens.arrow;
  const pt = fc.record({
    x: fc.integer({ min: -400, max: 400 }),
    y: fc.integer({ min: -400, max: 400 }),
  });

  it('контур не самопересекается, наконечник один — вершина в конце стрелки', () => {
    fc.assert(
      fc.property(pt, pt, (from, to) => {
        const shape = arrowShape(from, to, size, R);
        if (from.x === to.x && from.y === to.y) {
          expect(shape).toEqual([]);
          return;
        }
        expect(shape).toHaveLength(7);
        // Несоседние стороны многоугольника не пересекаются.
        const n = shape.length;
        for (let i = 0; i < n; i += 1) {
          for (let j = i + 2; j < n; j += 1) {
            if (i === 0 && j === n - 1) continue;
            const a = shape[i] as Point;
            const b = shape[(i + 1) % n] as Point;
            const c = shape[j] as Point;
            const d = shape[(j + 1) % n] as Point;
            expect(cross(a, b, c, d)).toBe(false);
          }
        }
        // Острая вершина одна — конец стрелки: дальше всех вдоль направления стрелки.
        const along = (p: Point): number =>
          (p.x - from.x) * (to.x - from.x) + (p.y - from.y) * (to.y - from.y);
        const tips = shape.filter((p) => along(p) >= along(to) - 1e-9);
        expect(tips).toEqual([to]);
      }),
      { numRuns: 500, seed: 5 },
    );
  });
});
