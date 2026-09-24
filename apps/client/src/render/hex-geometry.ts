// Геометрия flat-top гексов в мировых координатах рендера (px при масштабе 1,0).
// Ось r направлена вниз по экрану (docs/gdd/01-map.md, «Сетка»).
import type { Hex } from '@hexfront/sim';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const SQRT3 = Math.sqrt(3);

/** Центр гекса. */
export function hexCenter(h: Hex, radius: number): Point {
  return { x: radius * 1.5 * h.q, y: radius * SQRT3 * (h.r + h.q / 2) };
}

/** Вершина k (0–5) гекса; вершина 0 — справа, обход по часовой стрелке на экране. */
export function hexCorner(center: Point, radius: number, k: number): Point {
  const angle = (Math.PI / 3) * k;
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}

/** Шесть вершин гекса плоским массивом [x0, y0, x1, y1, …] для Pixi. */
export function hexPolygon(center: Point, radius: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 6; k += 1) {
    const c = hexCorner(center, radius, k);
    out.push(c.x, c.y);
  }
  return out;
}

// Направление d (SE, NE, N, NW, SW, S) смотрит под углом 30° − 60°·d; его ребро лежит между
// вершинами по обе стороны от этого угла.
const EDGE_CORNERS: readonly (readonly [number, number])[] = [
  [0, 1],
  [5, 0],
  [4, 5],
  [3, 4],
  [2, 3],
  [1, 2],
];

/** Концы ребра гекса в направлении d. */
export function hexEdge(center: Point, radius: number, d: number): [Point, Point] {
  const [a = 0, b = 0] = EDGE_CORNERS[d] ?? [];
  return [hexCorner(center, radius, a), hexCorner(center, radius, b)];
}

/** Прямоугольник, охватывающий все гексы карты width × height (offset even-q). */
export function mapBounds(width: number, height: number, radius: number): Rect {
  const halfH = (radius * SQRT3) / 2;
  // Центры even-q: x = 1,5R·col, y = √3R·row со сдвигом нечётных столбцов на полгекса вверх.
  const minX = -radius;
  const maxX = radius * 1.5 * (width - 1) + radius;
  const minY = width > 1 ? -2 * halfH : -halfH;
  const maxY = radius * SQRT3 * (height - 1) + halfH;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Гекс под точкой мира (обратное к hexCenter, округление кубических координат). */
export function pixelToHex(p: Point, radius: number): Hex {
  const q = ((2 / 3) * p.x) / radius;
  const r = ((-1 / 3) * p.x + (SQRT3 / 3) * p.y) / radius;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // -0 от Math.round при отрицательных долях сравнивается как 0, но ломает toEqual.
  return { q: rq + 0, r: rr + 0 };
}
