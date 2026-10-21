import { readFileSync } from 'node:fs';

import { GraphicsContext } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { edgeOf, loadMap, type PlanView } from '@hexfront/sim';

import {
  createPlanLayer,
  frontAppearance,
  frontTickSegments,
  isPointNearPath,
} from '../src/dev/plan-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { armyColor } from '../src/theme/colors.ts';
import { tokens } from '../src/theme/tokens.ts';

describe('прогноз у линии наступления', () => {
  const path = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  ] as const;

  it('показывает попадание рядом с отрезком', () => {
    expect(isPointNearPath({ x: 50, y: 10 }, path, 10)).toBe(true);
  });

  it('скрывает прогноз далеко от линии', () => {
    expect(isPointNearPath({ x: 50, y: 11 }, path, 10)).toBe(false);
  });

  it('учитывает короткий отрезок и его концы', () => {
    expect(isPointNearPath({ x: -5, y: 0 }, path, 5)).toBe(true);
  });
});

describe('видимость линии фронта', () => {
  it('строит штрихи по всей длине и перпендикулярно горизонтальному участку', () => {
    const segments = frontTickSegments(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      5,
      10,
    );

    expect(segments).toHaveLength(11);
    for (const segment of segments) {
      const [a, b] = segment;
      if (!a || !b) throw new Error('штрих должен иметь две точки');
      const { x: ax, y: ay } = a;
      const { x: bx, y: by } = b;
      expect(Math.hypot(bx - ax, by - ay)).toBe(5);
      expect((bx - ax) * 1 + (by - ay) * 0).toBe(0);
    }
  });

  it('выделяет выбранную армию alpha=1 и соседней шириной', () => {
    const appearance = frontAppearance(7, 7, 1);

    expect(appearance.alpha).toBe(1);
    expect(appearance.width).toBe(tokens.front.width[2]);
    expect(appearance.detailShift).toBe(1);
  });

  it('оставляет невыбранную армию полной и не меняет её ширину', () => {
    const appearance = frontAppearance(7, 8, 1);

    expect(appearance.alpha).toBe(1);
    expect(appearance.width).toBe(tokens.front.width[1]);
    expect(appearance.detailShift).toBe(0);
  });

  it('при отсутствии выбора не выделяет ни одну армию', () => {
    expect(frontAppearance(null, 7, 1).alpha).toBe(1);
    expect(frontAppearance(null, 7, 1).width).toBe(tokens.front.width[1]);
  });

  it('через setView передаёт фактические alpha и ширину stroke для выбранной и остальных армий', () => {
    const raw = JSON.parse(
      readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
    ) as unknown;
    const loaded = loadMap(raw);
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    const engine = createLocalEngine(raw, 42, 3);
    if ('errors' in engine) throw new Error(engine.errors.join('\n'));
    const snapshot = engine.tick();
    if (snapshot.t !== 'view') throw new Error('ожидался снимок вида');
    const [selected] = snapshot.view.armies;
    const edges = [edgeOf(0, 0), edgeOf(1, 0)];
    const other = selected
      ? { id: selected.id + 1000, number: selected.number + 1, name: 'Тестовая армия', auto: false }
      : undefined;
    if (!selected || !other) throw new Error('недостаточно данных для теста');
    const plans: PlanView[] = [selected, other].flatMap((army, index) => [
      {
        armyId: army.id,
        kind: 'front' as const,
        edges: [edges[index] as number],
        hexes: [],
        offensive: null,
        zone: [],
        stuck: false,
        facing: [],
        lost: [],
        startWanted: false,
      },
      {
        armyId: army.id,
        kind: 'line' as const,
        edges: [],
        hexes: [index],
        offensive: null,
        zone: [],
        stuck: false,
        facing: [],
        lost: [],
        startWanted: false,
      },
    ]);
    const view = { ...snapshot.view, armies: [selected, other], plans };
    const layer = createPlanLayer(loaded.map, tokens.map.hexRadius, () => ({ x: 0, y: 0 }));
    const strokes: Array<{ alpha?: number; width?: number; color?: string }> = [];
    const stroke = vi.spyOn(GraphicsContext.prototype, 'stroke').mockImplementation(function (
      this: GraphicsContext,
      ...args
    ) {
      const options = args[0];
      if (typeof options === 'object' && options !== null) {
        const value = options as { alpha?: number; width?: number; color?: string };
        strokes.push(value);
      }
      return this;
    });
    try {
      layer.setView(view, null, selected.id, null, 1, 2);
      const selectedStroke = strokes.find(({ color }) => color === armyColor(selected.number));
      const otherStroke = strokes.find(({ color }) => color === armyColor(other.number));
      const selectedTicks = strokes.filter(
        ({ color, width }) =>
          color === armyColor(selected.number) && width === tokens.front.tickWidth,
      );
      const otherTicks = strokes.filter(
        ({ color, width }) => color === armyColor(other.number) && width === tokens.front.tickWidth,
      );
      const otherCasing = strokes.find(
        ({ color, width }) =>
          color === tokens.front.casing &&
          width === tokens.front.width[1] + 2 * tokens.front.casingWidth,
      );
      expect(selectedStroke?.width).toBe(tokens.front.width[2]);
      expect(selectedStroke?.alpha).toBe(1);
      expect(otherStroke?.width).toBe(tokens.front.width[1]);
      expect(otherStroke?.alpha).toBe(1);
      expect(selectedTicks.length).toBeGreaterThan(0);
      expect(selectedTicks.every(({ alpha }) => alpha === 1)).toBe(true);
      expect(otherTicks.length).toBeGreaterThan(0);
      expect(otherTicks.every(({ alpha }) => alpha === 1)).toBe(true);
      expect(otherCasing?.alpha).toBe(1);

      for (const army of [selected, other]) {
        const armyStrokes = strokes.filter(
          ({ alpha, color, width }) =>
            color === armyColor(army.number) &&
            alpha !== undefined &&
            width !== tokens.front.tickWidth,
        );
        expect(armyStrokes.length).toBeGreaterThanOrEqual(2);
        expect(armyStrokes.every(({ alpha }) => alpha === 1)).toBe(true);
      }

      strokes.length = 0;
      layer.setView(view, null, null, null, 1, 2);
      const plainStrokes = strokes.filter(
        ({ color, width }) =>
          (color === armyColor(selected.number) || color === armyColor(other.number)) &&
          width === tokens.front.width[1],
      );
      expect(plainStrokes).toHaveLength(4);
      expect(plainStrokes.every(({ alpha }) => alpha === 1)).toBe(true);
    } finally {
      stroke.mockRestore();
      layer.destroy();
    }
  });

  it('сохраняет хвосты наступления и alpha при выборе армии', () => {
    const raw = JSON.parse(
      readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
    ) as unknown;
    const loaded = loadMap(raw);
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    const engine = createLocalEngine(raw, 42, 3);
    if ('errors' in engine) throw new Error(engine.errors.join('\n'));
    const snapshot = engine.tick();
    if (snapshot.t !== 'view') throw new Error('ожидался снимок вида');
    const army = snapshot.view.armies[0];
    if (!army) throw new Error('нужна армия для плана');
    const edges = [edgeOf(0, 0), edgeOf(1, 0)];
    const plan: PlanView = {
      armyId: army.id,
      kind: 'front',
      edges,
      hexes: [],
      offensive: { edges, hexes: [], active: false, progressTick: 0, taken: [] },
      zone: [],
      stuck: false,
      facing: edges,
      lost: [],
      startWanted: false,
    };
    const view = { ...snapshot.view, armies: [army], plans: [plan] };
    const layer = createPlanLayer(loaded.map, tokens.map.hexRadius, () => ({ x: 0, y: 0 }));
    const fills: Array<{ readonly color?: string; readonly alpha?: number }> = [];
    const fill = vi.spyOn(GraphicsContext.prototype, 'fill').mockImplementation(function (
      this: GraphicsContext,
      ...args
    ) {
      const options = args[0];
      if (typeof options === 'object' && options !== null) {
        const value = options as { color?: string; alpha?: number };
        fills.push(value);
      }
      return this;
    });
    const tails = (): Array<{ readonly color?: string; readonly alpha?: number }> =>
      fills.filter(({ color }) => color === tokens.arrow.color);
    try {
      layer.setView(view, null, army.id, null, 1, 2);
      const selected = [...tails()];
      fills.length = 0;
      layer.setView(view, null, null, null, 1, 2);
      const unselected = [...tails()];

      expect(selected.length).toBeGreaterThan(0);
      expect(unselected).toHaveLength(selected.length);
      expect(unselected.map(({ alpha }) => alpha)).toEqual(selected.map(({ alpha }) => alpha));
      expect(selected.every(({ alpha }) => alpha !== undefined)).toBe(true);
    } finally {
      fill.mockRestore();
      layer.destroy();
    }
  });
});
