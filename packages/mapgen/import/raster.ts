// Растеризация полигонов на сетку гексов: быстрый тест «точка внутри» и геометрия сетки.
import { hexFromId, type Hex } from '@hexfront/sim';

import type { Point, Shape } from './shapefile.ts';

interface Edge {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * Маска полигонов: рёбра разложены по горизонтальным полосам, поэтому тест точки смотрит только
 * рёбра своей полосы, а не все точки материка.
 * Кольца слоя считаются вместе по правилу чёт-нечет: дырки вычитаются.
 */
export class Mask {
  private readonly bands: Edge[][];
  private readonly low: number;
  private readonly scale: number;
  private readonly high: number;

  public constructor(shapes: readonly Shape[], min: Point, max: Point) {
    const count = 800;
    this.low = min.y;
    this.high = max.y;
    this.scale = count / (max.y - min.y);
    this.bands = Array.from({ length: count }, () => []);
    for (const shape of shapes)
      for (const ring of shape.parts)
        for (let i = 0, prev = ring.length - 1; i < ring.length; prev = i++) {
          const a = ring[prev];
          const b = ring[i];
          if (!a || !b || a.y === b.y || Math.max(a.x, b.x) < min.x) continue;
          const first = Math.max(0, Math.floor((Math.min(a.y, b.y) - this.low) * this.scale));
          const last = Math.min(
            count - 1,
            Math.floor((Math.max(a.y, b.y) - this.low) * this.scale),
          );
          const edge = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
          for (let band = first; band <= last; band += 1) this.bands[band]?.push(edge);
        }
  }

  /** Лежит ли точка внутри.  */
  public contains(point: Point): boolean {
    if (point.y < this.low || point.y > this.high) return false;
    const band = Math.floor((point.y - this.low) * this.scale);
    const edges = this.bands[band];
    if (!edges) return false;
    let inside = false;
    for (const e of edges) {
      if (e.y1 > point.y === e.y2 > point.y) continue;
      if (point.x < ((e.x2 - e.x1) * (point.y - e.y1)) / (e.y2 - e.y1) + e.x1) inside = !inside;
    }
    return inside;
  }
}

/** Сетка карты: прямоугольник проекции и число столбцов/строк (even-q, flat-top). */
export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly min: Point;
  readonly max: Point;
}

/** Размер сетки под `hexes` гексов с пропорцией прямоугольника проекции. */
export function makeGrid(min: Point, max: Point, hexes: number): Grid {
  // Шаг гекса flat-top: 1,5 R по x и √3 R по y, поэтому ширина/высота сетки = 1,1547 × пропорция.
  const ratio = (max.x - min.x) / (max.y - min.y);
  const width = Math.ceil(Math.sqrt(hexes * ratio * 1.1547));
  return { width, height: Math.ceil(hexes / width), min, max };
}

/** Центр гекса (нечётные столбцы сдвинуты вниз на полгекса) в проекции; север сверху. */
export function hexPoint(grid: Grid, col: number, row: number): Point {
  const rows = grid.height + 0.5;
  return {
    x: grid.min.x + ((col + 0.5) / grid.width) * (grid.max.x - grid.min.x),
    y: grid.max.y - ((row + 0.5 * (col & 1) + 0.5) / rows) * (grid.max.y - grid.min.y),
  };
}

/** Радиус гекса в метрах проекции (по шагу столбцов). */
export function hexRadius(grid: Grid): number {
  return (grid.max.x - grid.min.x) / grid.width / 1.5;
}

/** Ближайший к точке проекции гекс (в границах сетки). */
export function pointHex(grid: Grid, point: Point): Hex {
  const col = Math.max(
    0,
    Math.min(
      grid.width - 1,
      Math.round(((point.x - grid.min.x) / (grid.max.x - grid.min.x)) * grid.width - 0.5),
    ),
  );
  const rows = grid.height + 0.5;
  const row = Math.max(
    0,
    Math.min(
      grid.height - 1,
      Math.round(
        ((grid.max.y - point.y) / (grid.max.y - grid.min.y)) * rows - 0.5 - 0.5 * (col & 1),
      ),
    ),
  );
  return hexFromId(col + row * grid.width, grid.width);
}

/** Объединение масок по одной на фигуру: перекрывающиеся полигоны (хребты, пустыни) не гасят друг друга. */
export function unionMask(
  shapes: readonly Shape[],
  min: Point,
  max: Point,
): { contains(p: Point): boolean } {
  const masks = shapes.map((shape) => new Mask([shape], min, max));
  return { contains: (point) => masks.some((mask) => mask.contains(point)) };
}
