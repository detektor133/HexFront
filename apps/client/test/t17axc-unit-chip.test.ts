import { readFileSync } from 'node:fs';

import { Graphics, GraphicsContext } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { hexFromId, hexId, loadMap, neighbors, type PlayerView } from '@hexfront/sim';

import { createUnitLayer } from '../src/dev/unit-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);

function sourceView(): {
  readonly view: PlayerView;
  readonly width: number;
  readonly unitId: number;
} {
  const loaded = loadMap(mapJson);
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const view = engine.snapshot().view;
  const unit = view.units.find((candidate) => candidate.owner === view.playerId);
  if (!unit) throw new Error('Свой отряд не найден');
  return { view: { ...view, units: [unit] }, width: loaded.map.width, unitId: unit.id };
}

function withOrder(
  view: PlayerView,
  unitId: number,
  order: 'idle' | 'attack' | 'retreat',
  target = -1,
): PlayerView {
  return {
    ...view,
    units: view.units.map((unit) => (unit.id === unitId ? { ...unit, order, target } : unit)),
  };
}

function chipGraphics(layer: ReturnType<typeof createUnitLayer>): Graphics {
  const chips = layer.container.children[0];
  const root = chips?.children[1];
  const content = root?.children[0];
  const graphic = content?.children[0];
  if (!(graphic instanceof Graphics)) throw new Error('Графика фишки не найдена');
  return graphic;
}

function roundedStrokes(spy: ReturnType<typeof vi.spyOn>): number {
  return spy.mock.calls.filter(
    ([style]: [unknown]) =>
      typeof style === 'object' &&
      style !== null &&
      'width' in style &&
      style.width === 2 &&
      'cap' in style &&
      style.cap === 'round' &&
      'join' in style &&
      style.join === 'round',
  ).length;
}

function normalizedSegments(graphic: Graphics): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  for (const instruction of graphic.context.instructions) {
    const data = instruction.data;
    const path =
      typeof data === 'object' && data !== null && 'path' in data
        ? (data.path as unknown as
            { instructions?: Array<{ action: string; data?: [number, number] }> } | undefined)
        : undefined;
    let previous: { x: number; y: number } | null = null;
    for (const command of path?.instructions ?? []) {
      if (command.action !== 'moveTo' && command.action !== 'lineTo') continue;
      const point = { x: command.data?.[0] ?? 0, y: command.data?.[1] ?? 0 };
      if (command.action === 'lineTo' && previous) {
        const length = Math.hypot(point.x - previous.x, point.y - previous.y);
        if (length > 0)
          segments.push([(point.x - previous.x) / length, (point.y - previous.y) / length]);
      }
      previous = point;
    }
  }
  return segments;
}

describe('07/T17axc: состояние атаки на фишке отряда', () => {
  it('показывает указатель в атаке и убирает его при переходах idle → attack → idle/retreat', () => {
    const stroke = vi.spyOn(GraphicsContext.prototype, 'stroke');
    const { view, width, unitId } = sourceView();
    const layer = createUnitLayer(width, tokens.map.hexRadius, (hex) =>
      hexCenter(hexFromId(hex, width), tokens.map.hexRadius),
    );
    try {
      layer.setView(withOrder(view, unitId, 'idle'), { hex: null, units: [], target: null }, 0);
      expect(roundedStrokes(stroke)).toBe(1);

      const source = view.units.find((unit) => unit.id === unitId);
      if (!source) throw new Error('Свой отряд не найден');
      const neighbor = neighbors(hexFromId(source.hex, width))[0];
      if (!neighbor) throw new Error('Соседний гекс не найден');
      const target = hexId(neighbor, width);
      stroke.mockClear();
      layer.setView(
        withOrder(view, unitId, 'attack', target),
        { hex: null, units: [], target: null },
        0,
      );
      expect(roundedStrokes(stroke)).toBe(2);

      stroke.mockClear();
      layer.setView(withOrder(view, unitId, 'idle'), { hex: null, units: [], target: null }, 0);
      expect(roundedStrokes(stroke)).toBe(1);

      stroke.mockClear();
      layer.setView(withOrder(view, unitId, 'retreat'), { hex: null, units: [], target: null }, 0);
      expect(roundedStrokes(stroke)).toBe(1);
    } finally {
      stroke.mockRestore();
      layer.destroy();
    }
  });

  it('поворачивает указатель к целевому гексу по всем шести направлениям', () => {
    const { view, width, unitId } = sourceView();
    const source = view.units.find((unit) => unit.id === unitId);
    if (!source) throw new Error('Свой отряд не найден');
    const origin = hexCenter(hexFromId(source.hex, width), tokens.map.hexRadius);

    for (const target of neighbors(hexFromId(source.hex, width))) {
      const layer = createUnitLayer(width, tokens.map.hexRadius, (hex) =>
        hexCenter(hexFromId(hex, width), tokens.map.hexRadius),
      );
      try {
        layer.setView(
          withOrder(view, unitId, 'attack', hexId(target, width)),
          { hex: null, units: [], target: null },
          0,
        );
        const targetCenter = hexCenter(target, tokens.map.hexRadius);
        const distance = Math.hypot(targetCenter.x - origin.x, targetCenter.y - origin.y);
        const expected: [number, number] = [
          (targetCenter.x - origin.x) / distance,
          (targetCenter.y - origin.y) / distance,
        ];
        const points = normalizedSegments(chipGraphics(layer));
        expect(points.some(([x, y]) => x * expected[0] + y * expected[1] > 0.99)).toBe(true);
      } finally {
        layer.destroy();
      }
    }
  });
});
