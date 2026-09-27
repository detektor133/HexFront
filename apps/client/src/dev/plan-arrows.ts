// Геометрия линии наступления (art/units.md, «Линия наступления»): гладкая кривая по серединам
// граней и стрелки от фронта к линии, разнесённые по кускам фронта и линии без перескоков.
import { smooth } from './plan-edges.ts';
import type { Point } from '../render/hex-geometry.ts';

/**
 * Проходов Чайкина по серединам граней. Вместе с двумя проходами скользящего среднего волна
 * середин на прямой границе (±8,7 px при R = 20) гасится до ±1,6 px.
 */
const CURVE_ROUNDS = 3;

/** Длина ломаной. */
export function pathLength(pts: readonly Point[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    l += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return l;
}

/** Точка на ломаной на расстоянии s от начала. */
export function pointAlong(pts: readonly Point[], s: number): Point {
  let left = s;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= l && l > 0) {
      return { x: a.x + ((b.x - a.x) * left) / l, y: a.y + ((b.y - a.y) * left) / l };
    }
    left -= l;
  }
  return pts.at(-1) ?? { x: 0, y: 0 };
}

// Скользящее среднее [1, 2, 1] / 4; крайние точки остаются на месте.
function average(pts: readonly Point[]): Point[] {
  return pts.map((p, i) => {
    const a = pts[i - 1];
    const b = pts[i + 1];
    return a && b ? { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 } : p;
  });
}

/**
 * Гладкая кривая куска линии: опорные точки — середины граней (углы run попарно), концы — на
 * концах куска; два прохода скользящего среднего по серединам, затем сглаживание Чайкина. Через сами середины кривая не проходит — на гексах с
 * плоской вершиной они идут волной.
 * @param run углы гексов по порядку (ломаная куска из edgeRuns), мировые координаты
 * @returns точки кривой
 */
export function offensiveCurve(run: readonly Point[]): Point[] {
  const first = run[0];
  const last = run.at(-1);
  if (!first || !last || run.length < 2) return [...run];
  const mids = run
    .slice(1)
    .map((b, i) => ({ x: ((run[i] as Point).x + b.x) / 2, y: ((run[i] as Point).y + b.y) / 2 }));
  const avg = average(average(mids));
  return smooth([first, ...avg, last], CURVE_ROUNDS);
}

// Точка на кусках на расстоянии s от начала первого куска; разрывы между кусками не считаются.
function alongRuns(runs: readonly Point[][], s: number): Point {
  let left = s;
  for (const r of runs) {
    const l = pathLength(r);
    if (left <= l) return pointAlong(r, left);
    left -= l;
  }
  return runs.at(-1)?.at(-1) ?? { x: 0, y: 0 };
}

// Направление «вдоль»: от начала первого куска к концу последнего.
function axisOf(runs: readonly Point[][]): Point {
  const a = runs[0]?.[0];
  const b = runs.at(-1)?.at(-1);
  return a && b ? { x: b.x - a.x, y: b.y - a.y } : { x: 0, y: 0 };
}

/**
 * Пары «начало — конец» стрелок наступления: n точек равномерно по длине кусков фронта и по
 * длине кусков линии, в одном порядке вдоль фронта; куски линии развёрнуты и упорядочены по
 * направлению фронта — стрелки не пересекаются и не перескакивают через разрывы.
 * @returns n пар мировых точек
 */
export function arrowPairs(
  front: readonly Point[][],
  line: readonly Point[][],
  n: number,
): [Point, Point][] {
  let axis = axisOf(front);
  if (Math.hypot(axis.x, axis.y) < 1e-6) axis = axisOf(line);
  const proj = (p: Point): number => p.x * axis.x + p.y * axis.y;
  const ordered = line
    .filter((r) => r.length > 0)
    .map((r) => (proj(r.at(-1) as Point) < proj(r[0] as Point) ? [...r].reverse() : [...r]))
    .sort((a, b) => proj(a[0] as Point) - proj(b[0] as Point));
  const fl = front.reduce((s, r) => s + pathLength(r), 0);
  const ll = ordered.reduce((s, r) => s + pathLength(r), 0);
  const out: [Point, Point][] = [];
  for (let i = 0; i < n; i += 1) {
    const share = (2 * i + 1) / (2 * n);
    out.push([alongRuns(front, fl * share), alongRuns(ordered, ll * share)]);
  }
  return out;
}

/** Гексов смотрящего участка на одну стрелку; стрелок — от 1 до 3 (art/units.md). */
const HEXES_PER_ARROW = 4;
const MAX_ARROWS = 3;

/**
 * Число стрелок наступления: clamp(округл(ширина смотрящего участка / 4), 1, 3).
 * @param width ширина смотрящего участка фронта, гексов
 */
export function arrowCount(width: number): number {
  return Math.max(1, Math.min(MAX_ARROWS, Math.round(width / HEXES_PER_ARROW)));
}

// Отрезки ab и cd пересекаются во внутренней точке.
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/**
 * Стрелки наступления: хвосты равномерно по смотрящему участку фронта, концы — по линии, попарно
 * по порядку (`arrowPairs`); если на изогнутых кусках две стрелки всё же пересеклись, они
 * меняются концами — сумма длин строго уменьшается, поэтому распутывание конечно.
 * @returns n пар мировых точек «хвост — конец»
 */
export function offensiveArrows(
  facing: readonly Point[][],
  line: readonly Point[][],
  n: number,
): [Point, Point][] {
  const pairs = arrowPairs(facing, line, n);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < pairs.length; i += 1) {
      for (let j = i + 1; j < pairs.length; j += 1) {
        const p = pairs[i] as [Point, Point];
        const q = pairs[j] as [Point, Point];
        if (!crosses(p[0], p[1], q[0], q[1])) continue;
        pairs[i] = [p[0], q[1]];
        pairs[j] = [q[0], p[1]];
        changed = true;
      }
    }
  }
  return pairs;
}
