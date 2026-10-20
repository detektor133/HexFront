import { readFileSync } from 'node:fs';

import { GraphicsContext } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { BUILDING, loadMap, type PlayerView } from '@hexfront/sim';

import { createEconomyLayer } from '../src/dev/economy-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { playerLine } from '../src/theme/colors.ts';
import { tokens } from '../src/theme/tokens.ts';

const small = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
) as unknown;
const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));

function constructionView(): PlayerView {
  const engine = createLocalEngine(small, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const snapshot = engine.snapshot().view;
  const building = snapshot.hexes.building.slice();
  const improvement = snapshot.hexes.improvement.slice();
  const owner = snapshot.hexes.owner.slice();
  building[0] = BUILDING.fort;
  building[1] = BUILDING.depot;
  improvement[0] = 1;
  owner[0] = 0;
  owner[1] = 0;
  return {
    ...snapshot,
    cities: [],
    hexes: { ...snapshot.hexes, building, improvement, owner },
  };
}

function constructionPrimitives(): {
  colors: string[];
  polygons: unknown[][];
  circles: unknown[][];
  restore: () => void;
} {
  const colors: string[] = [];
  const polygons: unknown[][] = [];
  const circles: unknown[][] = [];
  const originalFill = GraphicsContext.prototype.fill;
  const originalPoly = GraphicsContext.prototype.poly;
  const originalCircle = GraphicsContext.prototype.circle;
  const fill = vi.spyOn(GraphicsContext.prototype, 'fill');
  const poly = vi.spyOn(GraphicsContext.prototype, 'poly');
  const circle = vi.spyOn(GraphicsContext.prototype, 'circle');
  fill.mockImplementation(function (this: GraphicsContext, ...args) {
    const color = args[0];
    if (typeof color === 'string') colors.push(color);
    return originalFill.apply(this, args);
  });
  poly.mockImplementation(function (this: GraphicsContext, ...args) {
    if (Array.isArray(args[0])) polygons.push([...args[0]]);
    return originalPoly.apply(this, args as Parameters<typeof originalPoly>);
  });
  circle.mockImplementation(function (this: GraphicsContext, ...args) {
    circles.push([...args]);
    return originalCircle.apply(this, args);
  });
  return {
    colors,
    polygons,
    circles,
    restore: () => {
      fill.mockRestore();
      poly.mockRestore();
      circle.mockRestore();
    },
  };
}

describe('знаки построек', () => {
  it('рисует fort, depot и improvement на реальном setView и не рисует пустой гекс', () => {
    const captured = constructionPrimitives();
    const layer = createEconomyLayer(loaded.map, tokens.map.hexRadius);
    const view = constructionView();

    layer.setView(view, { hex: null, units: [], target: null });

    expect(captured.colors.filter((color) => color === playerLine(0))).toHaveLength(3);
    expect(captured.polygons.some((points) => points.length === 8)).toBe(true);
    expect(captured.polygons.some((points) => points.length === 6)).toBe(true);
    expect(
      captured.circles.some(
        (args) => args[2] === tokens.map.hexRadius * tokens.construction.improvementSize,
      ),
    ).toBe(true);

    const empty = {
      ...view,
      hexes: {
        ...view.hexes,
        building: new Uint8Array(view.hexes.building.length),
        improvement: new Uint8Array(view.hexes.improvement.length),
      },
    };
    const fillsBeforeEmpty = captured.colors.length;
    layer.setView(empty, { hex: null, units: [], target: null });
    expect(captured.colors.length).toBe(fillsBeforeEmpty);
    layer.destroy();
    captured.restore();
  });

  it('сохраняет знаки из последовательного снимка под туманом', () => {
    const captured = constructionPrimitives();
    const layer = createEconomyLayer(loaded.map, tokens.map.hexRadius);
    const visible = constructionView();
    const hidden = {
      ...visible,
      hexes: { ...visible.hexes, visible: visible.hexes.visible.map(() => 0) },
    };

    layer.setView(visible, { hex: null, units: [], target: null });
    const first = captured.colors.length;
    layer.setView(hidden, { hex: null, units: [], target: null });

    expect(captured.colors.length - first).toBe(first);
    layer.destroy();
    captured.restore();
  });
});
