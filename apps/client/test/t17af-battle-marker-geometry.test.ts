import { GraphicsContext } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { createBattleMarker } from '../src/match/battle-marker.ts';
import { tokens } from '../src/theme/tokens.ts';

const MARKER_RADIUS_PX = 8;
const BLADE_LENGTH_PX = MARKER_RADIUS_PX * 1.4;
const BLADE_WIDTH_PX = MARKER_RADIUS_PX * 0.22;

function distance(x: number, y: number): number {
  return Math.hypot(x, y);
}

function dot(x: number, y: number, axisX: number, axisY: number): number {
  return x * axisX + y * axisY;
}

function coordinate(points: number[], index: number): number {
  const value = points[index];
  if (value === undefined) throw new Error('У клинка отсутствует координата');
  return value;
}

describe('геометрия маркера боя (07/T17af)', () => {
  it('рисует два залитых клинка поверх диаграммы без обводки креста', () => {
    const polygons: number[][] = [];
    const fills: unknown[] = [];
    const strokes: unknown[] = [];
    const operations: Array<{ kind: 'moveTo' | 'lineTo' | 'poly' | 'stroke' }> = [];
    const originalPoly = GraphicsContext.prototype.poly;
    const originalFill = GraphicsContext.prototype.fill;
    const originalStroke = GraphicsContext.prototype.stroke;
    const originalMoveTo = GraphicsContext.prototype.moveTo;
    const originalLineTo = GraphicsContext.prototype.lineTo;
    const poly = vi.spyOn(GraphicsContext.prototype, 'poly');
    const fill = vi.spyOn(GraphicsContext.prototype, 'fill');
    const stroke = vi.spyOn(GraphicsContext.prototype, 'stroke');
    const moveTo = vi.spyOn(GraphicsContext.prototype, 'moveTo');
    const lineTo = vi.spyOn(GraphicsContext.prototype, 'lineTo');
    poly.mockImplementation(function (this: GraphicsContext, ...args) {
      const points = args[0];
      if (
        Array.isArray(points) &&
        points.every((point): point is number => typeof point === 'number')
      ) {
        polygons.push([...points]);
      }
      const result = originalPoly.apply(this, args as Parameters<typeof originalPoly>);
      operations.push({ kind: 'poly' });
      return result;
    });
    fill.mockImplementation(function (this: GraphicsContext, ...args) {
      fills.push(args[0]);
      return originalFill.apply(this, args);
    });
    stroke.mockImplementation(function (this: GraphicsContext, ...args) {
      strokes.push(args[0]);
      operations.push({ kind: 'stroke' });
      return originalStroke.apply(this, args);
    });
    moveTo.mockImplementation(function (this: GraphicsContext, ...args) {
      operations.push({ kind: 'moveTo' });
      return originalMoveTo.apply(this, args);
    });
    lineTo.mockImplementation(function (this: GraphicsContext, ...args) {
      operations.push({ kind: 'lineTo' });
      return originalLineTo.apply(this, args);
    });

    const marker = createBattleMarker();
    marker.destroy();
    poly.mockRestore();
    fill.mockRestore();
    stroke.mockRestore();
    moveTo.mockRestore();
    lineTo.mockRestore();

    expect(polygons).toHaveLength(18);
    expect(polygons.slice(0, 2)).toHaveLength(2);
    expect(fills.filter((fillStyle) => fillStyle === tokens.ui.ink)).toHaveLength(18);
    expect(
      strokes.filter(
        (strokeStyle) =>
          typeof strokeStyle === 'object' &&
          strokeStyle !== null &&
          'color' in strokeStyle &&
          strokeStyle.color === tokens.ui.ink,
      ),
    ).toHaveLength(9);
    let bladeCount = 0;
    let secondBladeIndex: number | null = null;
    for (const [index, operation] of operations.entries()) {
      if (operation.kind === 'poly') {
        bladeCount += 1;
        if (bladeCount % 2 === 0) secondBladeIndex = index;
        continue;
      }
      if (operation.kind !== 'stroke') continue;
      if (secondBladeIndex !== null) {
        expect(
          operations
            .slice(secondBladeIndex + 1, index)
            .some(({ kind }) => kind === 'moveTo' || kind === 'lineTo'),
        ).toBe(false);
        secondBladeIndex = null;
      }
    }

    const axes = [
      { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
      { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
    ];
    for (const [index, polygon] of polygons.slice(0, 2).entries()) {
      const points = [
        [coordinate(polygon, 0), coordinate(polygon, 1)],
        [coordinate(polygon, 2), coordinate(polygon, 3)],
        [coordinate(polygon, 4), coordinate(polygon, 5)],
        [coordinate(polygon, 6), coordinate(polygon, 7)],
      ] as const;
      const axis = axes[index];
      if (!axis) throw new Error('Ось клинка отсутствует');
      expect(distance(points[0][0], points[0][1])).toBeCloseTo(BLADE_LENGTH_PX, 6);
      expect(distance(points[2][0], points[2][1])).toBeCloseTo(BLADE_LENGTH_PX, 6);
      expect(dot(points[0][0], points[0][1], axis.x, axis.y)).toBeCloseTo(BLADE_LENGTH_PX, 6);
      expect(dot(points[2][0], points[2][1], axis.x, axis.y)).toBeCloseTo(-BLADE_LENGTH_PX, 6);
      expect(dot(points[1][0], points[1][1], axis.x, axis.y)).toBeCloseTo(0, 6);
      expect(dot(points[3][0], points[3][1], axis.x, axis.y)).toBeCloseTo(0, 6);
      expect(distance(points[1][0], points[1][1])).toBeCloseTo(BLADE_WIDTH_PX / 2, 6);
      expect(distance(points[3][0], points[3][1])).toBeCloseTo(BLADE_WIDTH_PX / 2, 6);
    }
  });
});
