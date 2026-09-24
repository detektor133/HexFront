// Гекс-математика: flat-top, осевые координаты (q, r), хранение в offset even-q.
// GDD: docs/gdd/01-map.md — «Сетка». Формулы — redblobgames.com/grids/hexagons.
import { floorDiv, intDiv } from './int.ts';

/** Осевые координаты гекса. */
export interface Hex {
  readonly q: number;
  readonly r: number;
}

/** Координаты в плотном массиве карты: столбец и строка (even-q). */
export interface OffsetCoord {
  readonly col: number;
  readonly row: number;
}

/** Индекс гекса в плотном массиве карты: `col + row * width`. */
export type HexId = number;

/** Номер направления 0–5 в порядке GDD: SE, NE, N, NW, SW, S. */
export type Direction = 0 | 1 | 2 | 3 | 4 | 5;

/** Векторы направлений; порядок фиксирован — от него зависит детерминизм обходов. */
export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function dir(d: number): Hex {
  const v = DIRECTIONS[((d % 6) + 6) % 6];
  if (!v) throw new RangeError(`направление вне диапазона: ${d}`);
  return v;
}

/**
 * Соседний гекс в направлении `d`.
 * @returns осевые координаты соседа
 */
export function neighbor(h: Hex, d: Direction): Hex {
  const v = dir(d);
  return { q: h.q + v.q, r: h.r + v.r };
}

/**
 * Шесть соседей в порядке направлений 0–5.
 * @returns массив из 6 гексов
 */
export function neighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((v) => ({ q: h.q + v.q, r: h.r + v.r }));
}

/**
 * Расстояние между гексами.
 * @returns число шагов по сетке
 */
export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return intDiv(Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr), 2);
}

/**
 * Кольцо гексов на расстоянии `radius`; для радиуса 0 — сам центр.
 * @returns 6·radius гексов (1 при radius = 0), обход против часовой стрелки
 */
export function ring(center: Hex, radius: number): Hex[] {
  if (radius === 0) return [center];
  const start = dir(4);
  let h: Hex = { q: center.q + start.q * radius, r: center.r + start.r * radius };
  const result: Hex[] = [];
  for (let side = 0; side < 6; side += 1) {
    for (let step = 0; step < radius; step += 1) {
      result.push(h);
      h = neighbor(h, side as Direction);
    }
  }
  return result;
}

/**
 * Все гексы на расстоянии ≤ `radius`, кольцами от центра наружу.
 * @returns 1 + 3·radius·(radius + 1) гексов
 */
export function spiral(center: Hex, radius: number): Hex[] {
  const result: Hex[] = [];
  for (let k = 0; k <= radius; k += 1) result.push(...ring(center, k));
  return result;
}

// Масштаб и сдвиг для целочисленного lerp: сдвиг меньше масштаба, поэтому влияет
// только на точные ничьи при округлении (аналог 1e-6 у redblobgames).
const LINE_SCALE = 1000;
const LINE_NUDGE = [1, 2, -3] as const;

function roundDiv(value: number, den: number): number {
  return floorDiv(2 * value + den, 2 * den);
}

/**
 * Отрезок гексов от `a` до `b` включительно; целочисленный аналог cube-lerp.
 * @returns distance(a, b) + 1 гексов
 */
export function line(a: Hex, b: Hex): Hex[] {
  const n = distance(a, b);
  if (n === 0) return [a];
  const den = n * LINE_SCALE;
  const as = [a.q, a.r, -a.q - a.r];
  const bs = [b.q, b.r, -b.q - b.r];
  const result: Hex[] = [];
  for (let i = 0; i <= n; i += 1) {
    const scaled = as.map((av, k) => {
      const bv = bs[k] ?? 0;
      return (av * (n - i) + bv * i) * LINE_SCALE + (LINE_NUDGE[k] ?? 0);
    });
    const rounded = scaled.map((v) => roundDiv(v, den));
    const diffs = scaled.map((v, k) => Math.abs(v - (rounded[k] ?? 0) * den));
    const [rq = 0, rr = 0, rs = 0] = rounded;
    const [dq = 0, dr = 0, ds = 0] = diffs;
    if (dq > dr && dq > ds) result.push({ q: -rr - rs, r: rr });
    else if (dr > ds) result.push({ q: rq, r: -rq - rs });
    else result.push({ q: rq, r: rr });
  }
  return result;
}

/**
 * Осевые координаты → offset even-q.
 * @returns столбец и строка плотного массива
 */
export function axialToOffset(h: Hex): OffsetCoord {
  return { col: h.q, row: h.r + intDiv(h.q + (h.q & 1), 2) };
}

/**
 * Offset even-q → осевые координаты.
 * @returns осевые координаты
 */
export function offsetToAxial(o: OffsetCoord): Hex {
  return { q: o.col, r: o.row - intDiv(o.col + (o.col & 1), 2) };
}

/**
 * Лежит ли гекс внутри карты `width × height`.
 * @returns true, если offset-координаты в пределах карты
 */
export function inBounds(h: Hex, width: number, height: number): boolean {
  const { col, row } = axialToOffset(h);
  return col >= 0 && col < width && row >= 0 && row < height;
}

/**
 * Индекс гекса в плотном массиве карты шириной `width`.
 * @returns HexId = col + row·width
 */
export function hexId(h: Hex, width: number): HexId {
  const { col, row } = axialToOffset(h);
  return col + row * width;
}

/**
 * Гекс по индексу в плотном массиве карты шириной `width`.
 * @returns осевые координаты
 */
export function hexFromId(id: HexId, width: number): Hex {
  return offsetToAxial({ col: id % width, row: intDiv(id, width) });
}
