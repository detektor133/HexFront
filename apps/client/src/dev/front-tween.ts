// Плавный переход линии фронта (04/T13): когда фронт едет за границей, линия не прыгает, а
// перетекает в новое положение за `motion.map` мс с кривой `motion.easing` (style-guide, «Движение»).
import type { Point } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

/** Точек на кусок линии при переходе — хватает для плавного изгиба на любой длине фронта. */
const SAMPLES = 48;

function bezierOf(css: string): [number, number, number, number] {
  const nums = (css.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = nums;
  return [x1, y1, x2, y2];
}

const [X1, Y1, X2, Y2] = bezierOf(tokens.motion.easing);
const coord = (p1: number, p2: number, s: number): number =>
  3 * p1 * s * (1 - s) ** 2 + 3 * p2 * s * s * (1 - s) + s ** 3;

/**
 * Кривая `motion.easing` (cubic-bezier): доля пути по доле времени.
 * @param t доля времени 0…1
 * @returns доля пути 0…1
 */
export function easeMap(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // Параметр кривой по x — делением пополам: x(s) монотонна.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (coord(X1, X2, mid) < t) lo = mid;
    else hi = mid;
  }
  return coord(Y1, Y2, (lo + hi) / 2);
}

// Ломаная, пересэмплированная в n точек равномерно по длине.
function resample(pts: readonly Point[], n: number): Point[] {
  const lens = [0];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    lens.push((lens[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lens.at(-1) ?? 0;
  const out: Point[] = [];
  let j = 1;
  for (let k = 0; k < n; k += 1) {
    const s = (total * k) / (n - 1);
    while (j < pts.length - 1 && (lens[j] as number) < s) j += 1;
    const a = pts[j - 1] ?? pts[0] ?? { x: 0, y: 0 };
    const b = pts[j] ?? a;
    const l0 = lens[j - 1] ?? 0;
    const l = (lens[j] ?? l0) - l0;
    const f = l > 0 ? (s - l0) / l : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

const gap = (a: readonly Point[], b: readonly Point[]): number => {
  const [a0, a1] = [a[0], a.at(-1)];
  const [b0, b1] = [b[0], b.at(-1)];
  if (!a0 || !a1 || !b0 || !b1) return 0;
  return Math.hypot(a0.x - b0.x, a0.y - b0.y) + Math.hypot(a1.x - b1.x, a1.y - b1.y);
};

/**
 * Линия фронта между прежним и новым положением: каждый кусок пересэмплирован по длине, концы
 * идут к ближним концам нового куска (без перекручивания). Разное число кусков — сразу новая.
 * @param p доля пути 0…1 (уже с кривой)
 * @returns ломаные в мировых координатах
 */
export function tweenRuns(
  from: readonly (readonly Point[])[],
  to: readonly (readonly Point[])[],
  p: number,
): Point[][] {
  if (p >= 1 || from.length !== to.length) return to.map((r) => [...r]);
  return to.map((target, i) => {
    const source = from[i] ?? target;
    const back = [...source].reverse();
    const a = resample(gap(back, target) < gap(source, target) ? back : source, SAMPLES);
    const b = resample(target, SAMPLES);
    return a.map((q, k) => {
      const r = b[k] ?? q;
      return { x: q.x + (r.x - q.x) * p, y: q.y + (r.y - q.y) * p };
    });
  });
}

interface Tween {
  readonly key: string;
  readonly from: Point[][];
  readonly to: Point[][];
  readonly start: number;
}

/** Переходы линий фронта по армиям. */
export interface FrontTweens {
  /** Линия фронта армии сейчас; новые грани (key) запускают переход от показанной линии. */
  runs(armyId: number, key: string, target: Point[][], nowMs: number): Point[][];
  /** Идёт ли хоть один переход (нужна перерисовка в следующем кадре). */
  active(nowMs: number): boolean;
  /** Забыть армии без фронта. */
  keep(armyIds: ReadonlySet<number>): void;
}

/** Переходы линий фронта; reduced — prefers-reduced-motion: линия встаёт сразу. */
export function createFrontTweens(reduced: boolean): FrontTweens {
  const byArmy = new Map<number, Tween>();
  const share = (tw: Tween, now: number): number =>
    reduced ? 1 : easeMap((now - tw.start) / tokens.motion.map);
  return {
    runs(armyId, key, target, nowMs) {
      const tw = byArmy.get(armyId);
      if (!tw) {
        byArmy.set(armyId, { key, from: target, to: target, start: -Infinity });
        return target;
      }
      if (tw.key !== key) {
        const shown = tweenRuns(tw.from, tw.to, share(tw, nowMs));
        byArmy.set(armyId, { key, from: shown, to: target, start: nowMs });
      }
      const now = byArmy.get(armyId) ?? tw;
      return tweenRuns(now.from, now.to, share(now, nowMs));
    },
    active(nowMs) {
      if (reduced) return false;
      for (const tw of byArmy.values()) if (nowMs - tw.start < tokens.motion.map) return true;
      return false;
    },
    keep(armyIds) {
      for (const id of [...byArmy.keys()]) if (!armyIds.has(id)) byArmy.delete(id);
    },
  };
}
