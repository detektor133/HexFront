import { readFileSync } from 'node:fs';

import { GraphicsContext } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { loadMap, type PlayerView } from '@hexfront/sim';

import { createEconomyLayer } from '../src/dev/economy-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { tokens } from '../src/theme/tokens.ts';

const small = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
) as unknown;
const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));

function viewWithConstructions(constructionCount: number): PlayerView {
  const arcConstructions = [
    { hex: 0, kind: 'city', owner: 0, progressTicks: 1, totalTicks: 10 },
    { hex: 1, kind: 'improvement', owner: 0, progressTicks: 2, totalTicks: 10 },
    { hex: 2, kind: 'fort', owner: 0, progressTicks: 3, totalTicks: 10 },
  ].slice(0, constructionCount);
  const constructions = [
    ...arcConstructions,
    { hex: 3, kind: 'road', owner: 0, progressTicks: 3, totalTicks: 10, path: [3, 4] },
  ];

  const engine = createLocalEngine(small, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const message = engine.tick();
  if (message.t !== 'view') throw new Error('ожидался снимок');
  return { ...message.view, constructions } as unknown as PlayerView;
}

type ArcPath = {
  center: readonly [number, number];
  radius: number;
  width: number;
  points: ReadonlyArray<number>;
};

type PolygonPrimitive = {
  type: 'polygon';
  points: ReadonlyArray<number>;
};

function assertArcPathsStayWithinTheirBounds(
  arcPaths: ReadonlyArray<ArcPath>,
  expectedArcCount: number,
): void {
  expect(arcPaths).toHaveLength(expectedArcCount);
  for (const {
    center: [x, y],
    radius,
    width,
    points,
  } of arcPaths) {
    for (let index = 0; index < points.length; index += 2) {
      const pointX = points[index];
      const pointY = points[index + 1];
      if (pointX === undefined || pointY === undefined) throw new Error('неполная точка пути дуги');
      expect(Math.hypot(pointX - x, pointY - y)).toBeLessThanOrEqual(radius + width);
    }
  }
}

function captureArcPaths(): { paths: ArcPath[]; restore: () => void } {
  const paths: ArcPath[] = [];
  const originalStroke = GraphicsContext.prototype.stroke;
  const stroke = vi.spyOn(GraphicsContext.prototype, 'stroke');
  stroke.mockImplementation(function (this: GraphicsContext, ...args) {
    const result = originalStroke.apply(this, args);
    const instruction = this.instructions.at(-1);
    const path = instruction?.action === 'stroke' ? instruction.data.path : undefined;
    const arc = path?.instructions.find((item) => item.action === 'arc');
    if (!path || !arc) return result;

    const [x, y, radius] = arc.data;
    const primitive = path.shapePath.shapePrimitives[0]?.shape;
    const points =
      primitive?.type === 'polygon' ? (primitive as unknown as PolygonPrimitive).points : undefined;
    const width =
      typeof args[0] === 'object' && args[0] !== null && 'width' in args[0]
        ? args[0].width
        : undefined;
    if (
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof radius === 'number' &&
      typeof width === 'number' &&
      points
    ) {
      paths.push({ center: [x, y], radius, width, points });
    }
    return result;
  });
  return { paths, restore: () => stroke.mockRestore() };
}

describe('дуги прогресса строек', () => {
  it('для двух строек и одной дороги начинает каждую дугу с точки её окружности', () => {
    const captured = captureArcPaths();
    const layer = createEconomyLayer(loaded.map, tokens.map.hexRadius);

    layer.setView(viewWithConstructions(2), { hex: null, units: [], target: null });

    assertArcPathsStayWithinTheirBounds(captured.paths, 2);
    layer.destroy();
    captured.restore();
  });

  it('для трёх строек и одной дороги не оставляет дугу продолжением предыдущего пути', () => {
    const captured = captureArcPaths();
    const layer = createEconomyLayer(loaded.map, tokens.map.hexRadius);

    layer.setView(viewWithConstructions(3), { hex: null, units: [], target: null });

    assertArcPathsStayWithinTheirBounds(captured.paths, 3);
    layer.destroy();
    captured.restore();
  });
});

describe('сторож начала дугового пути', () => {
  it('требует moveTo после stroke или fill перед дугой в трёх слоях Graphics', () => {
    const files = ['dev/economy-layer.ts', 'dev/plan-layer.ts', 'dev/unit-chips.ts'];
    for (const file of files) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      for (const arcPosition of [...source.matchAll(/\.arc\(/gu)].map(
        (match) => match.index ?? 0,
      )) {
        const pathBeforeArc = source.slice(Math.max(0, arcPosition - 500), arcPosition);
        const lastPathBreak = Math.max(
          pathBeforeArc.lastIndexOf('.clear('),
          pathBeforeArc.lastIndexOf('{'),
        );
        const path = pathBeforeArc.slice(lastPathBreak);
        const lastMove = path.lastIndexOf('.moveTo(');
        const lastStroke = Math.max(path.lastIndexOf('.stroke('), path.lastIndexOf('.fill('));
        expect(lastStroke, `${file}: дуга без предшествующего пути`).toBeLessThan(lastMove);
      }
    }
  });
});
