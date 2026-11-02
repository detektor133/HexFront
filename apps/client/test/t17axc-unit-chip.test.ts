import { readFileSync } from 'node:fs';

import { BitmapText, Graphics, GraphicsContext, type Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import {
  FP,
  hexFromId,
  hexId,
  loadMap,
  neighbors,
  type Fp,
  type PlayerView,
  type UnitView,
} from '@hexfront/sim';

import { chipHalf } from '../src/dev/chip-place.ts';
import { CHIP_STACK_STEP } from '../src/dev/unit-groups.ts';
import { createUnitLayer } from '../src/dev/unit-layer.ts';
import { formatSoldiers } from '../src/i18n/format.ts';
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

function screenYPositions(roots: readonly Container[]): number[] {
  return roots.map((root) => root.getGlobalPosition().y);
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

function graphicSignature(graphic: Graphics): string {
  return JSON.stringify(
    graphic.context.instructions.map((instruction) => {
      const data = instruction.data;
      if (typeof data !== 'object' || data === null) return { action: instruction.action };
      const path = 'path' in data ? data.path : undefined;
      const style = 'style' in data ? data.style : undefined;
      return {
        action: instruction.action,
        path:
          typeof path === 'object' && path !== null && 'instructions' in path
            ? path.instructions
            : null,
        style:
          typeof style === 'object' && style !== null
            ? Object.fromEntries(
                Object.entries(style).filter(([, value]) => typeof value !== 'object'),
              )
            : null,
      };
    }),
  );
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

describe('07/T17bt: вертикальная стопка отдельных фишек', () => {
  it('сопоставляет каждый тип отряда с его глифом на пути слоя фишек', () => {
    const source = sourceView();
    const original = source.view.units[0];
    if (!original) throw new Error('Свой отряд не найден');
    const types = [
      { type: 'infantry', primitive: 'lineTo' },
      { type: 'armor', primitive: 'poly' },
      { type: 'artillery', primitive: 'arc' },
    ] as const;
    const spies = {
      lineTo: vi.spyOn(Graphics.prototype, 'lineTo'),
      poly: vi.spyOn(Graphics.prototype, 'poly'),
      arc: vi.spyOn(Graphics.prototype, 'arc'),
      circle: vi.spyOn(Graphics.prototype, 'circle'),
    };

    try {
      for (const { type, primitive } of types) {
        Object.values(spies).forEach((spy) => spy.mockClear());
        const layer = createUnitLayer(source.width, tokens.map.hexRadius, (hex) =>
          hexCenter(hexFromId(hex, source.width), tokens.map.hexRadius),
        );
        try {
          layer.setView(
            { ...source.view, units: [{ ...original, type }] },
            { hex: null, units: [], target: null },
            0,
          );
          expect(spies[primitive]).toHaveBeenCalled();
          if (type === 'infantry') {
            const lines = spies.lineTo.mock.calls;
            const first = lines.at(-2)?.slice(0, 2);
            const second = lines.at(-1)?.slice(0, 2);
            if (!first || !second) throw new Error('Сегменты глифа пехоты не найдены');
            const [firstX, firstY] = first;
            const [secondX, secondY] = second;
            if (
              firstX === undefined ||
              firstY === undefined ||
              secondX === undefined ||
              secondY === undefined
            )
              throw new Error('Координаты глифа пехоты неполные');
            expect([secondX - firstX, secondY - firstY]).toEqual([5, 5]);
          }
          if (type === 'armor') {
            const points = spies.poly.mock.calls.at(-1)?.[0];
            if (!points) throw new Error('Координаты глифа брони не найдены');
            const coordinates = points.flatMap((point) =>
              typeof point === 'number' ? [point] : [point.x, point.y],
            );
            expect(
              coordinates.slice(2).map((coordinate, index) => {
                const origin = coordinates[index];
                if (origin === undefined)
                  throw new Error('Нарушена последовательность точек глифа');
                return coordinate - origin;
              }),
            ).toEqual([5, 5, -5, 5, -5, -5]);
          }
          if (type === 'artillery') {
            const arc = spies.arc.mock.calls.at(-1);
            const circle = spies.circle.mock.calls.at(-1);
            expect(arc?.slice(2)).toEqual([5, Math.PI, 0]);
            expect(circle?.slice(0, 2)).toEqual(arc?.slice(0, 2));
            expect(circle?.[2]).toBe(1.75);
          }
          if (primitive !== 'lineTo') expect(spies.lineTo).not.toHaveBeenCalled();
          if (type === 'artillery') expect(spies.circle).toHaveBeenCalled();
          else expect(spies.circle).not.toHaveBeenCalled();
          if (type !== 'artillery') expect(spies.arc).not.toHaveBeenCalled();
          if (type !== 'armor') expect(spies.poly).not.toHaveBeenCalled();
        } finally {
          layer.destroy();
        }
      }
    } finally {
      Object.values(spies).forEach((spy) => spy.mockRestore());
    }
  });

  it('рисует три самостоятельных отряда со своими числами и непересекающимися позициями', () => {
    const { view: source, width } = sourceView();
    const original = source.units[0];
    if (!original) throw new Error('Свой отряд не найден');
    const army = source.armies[0];
    if (!army) throw new Error('Армия фикстуры не найдена');
    const secondArmy = { ...army, id: army.id + 1, number: army.number + 1 };
    const units = [
      {
        ...original,
        id: original.id,
        type: 'infantry' as const,
        soldiers: (1250 * FP) as Fp,
        org: 900 as Fp,
        supplyLevel: 900 as Fp,
      },
      {
        ...original,
        id: original.id + 1,
        type: 'armor' as const,
        soldiers: (620 * FP) as Fp,
        org: 700 as Fp,
        supplyLevel: 600 as Fp,
        armyId: secondArmy.id,
      },
      {
        ...original,
        id: original.id + 2,
        type: 'artillery' as const,
        soldiers: (180 * FP) as Fp,
        org: 500 as Fp,
        supplyLevel: 300 as Fp,
      },
    ];
    const view: PlayerView = { ...source, units, armies: [...source.armies, secondArmy] };
    const layer = createUnitLayer(width, tokens.map.hexRadius, (hex) =>
      hexCenter(hexFromId(hex, width), tokens.map.hexRadius),
    );
    try {
      layer.setView(view, { hex: null, units: [], target: null }, 0);
      const chipsLayer = layer.container.children[0];
      if (!chipsLayer) throw new Error('Слой фишек не найден');
      const roots = chipsLayer.children.slice(1);
      expect(roots).toHaveLength(3);
      const ordered = [...roots].sort((a, b) => a.position.y - b.position.y);
      const first = ordered[0];
      const second = ordered[1];
      const third = ordered[2];
      if (!first || !second || !third) throw new Error('Стопка должна содержать три фишки');
      const screenY = screenYPositions(ordered);
      const firstY = screenY[0];
      const secondY = screenY[1];
      const thirdY = screenY[2];
      if (firstY === undefined || secondY === undefined || thirdY === undefined)
        throw new Error('Экранные координаты стопки не найдены');
      expect(secondY - firstY).toBeCloseTo(CHIP_STACK_STEP);
      expect(thirdY - secondY).toBeCloseTo(CHIP_STACK_STEP);
      expect(second.position.y - first.position.y).toBeCloseTo(2 * chipHalf());
      expect(third.position.y - second.position.y).toBeCloseTo(2 * chipHalf());
      expect(third.position.y - first.position.y).toBeGreaterThan(2 * chipHalf());
      const rendered = ordered.map((root) => {
        const content = root.children[0];
        const graphic = content?.children[0];
        const label = content?.children[1];
        if (!(graphic instanceof Graphics) || !(label instanceof BitmapText))
          throw new Error('Содержимое фишки не найдено');
        return { root, graphic, label };
      });
      expect(rendered.map(({ label }) => label.text)).toEqual(
        units.map(({ soldiers }) => formatSoldiers(soldiers)),
      );

      const bounds = rendered.map(({ graphic }) => graphic.getBounds());
      for (let index = 0; index < bounds.length - 1; index += 1) {
        const current = bounds[index];
        const next = bounds[index + 1];
        if (!current || !next) throw new Error('Границы фишки не найдены');
        expect(current.y + current.height).toBeLessThanOrEqual(next.y);
      }

      const graphics = rendered.map(({ graphic }) => graphicSignature(graphic));
      expect(new Set(graphics).size).toBe(3);

      const renderVariant = (changed: UnitView): string => {
        const variantLayer = createUnitLayer(width, tokens.map.hexRadius, (hex) =>
          hexCenter(hexFromId(hex, width), tokens.map.hexRadius),
        );
        try {
          variantLayer.setView(
            { ...view, units: [changed] },
            { hex: null, units: [], target: null },
            0,
          );
          const graphic = variantLayer.container.children[0]?.children[1]?.children[0]?.children[0];
          if (!(graphic instanceof Graphics)) throw new Error('Графика варианта не найдена');
          return graphicSignature(graphic);
        } finally {
          variantLayer.destroy();
        }
      };

      for (const [index, unit] of units.entries()) {
        expect(graphics[index]).toBe(renderVariant(unit));
        const withoutArmy = { ...unit, armyId: -1 };
        const changedOrg = { ...unit, org: (unit.org === 0 ? 1 : 0) as Fp };
        const changedSupply = {
          ...unit,
          supplyLevel: (unit.supplyLevel === 0 ? 1000 : 0) as Fp,
        };
        expect(graphics[index]).not.toBe(renderVariant(withoutArmy));
        expect(graphics[index]).not.toBe(renderVariant(changedOrg));
        expect(graphics[index]).not.toBe(renderVariant(changedSupply));
      }
    } finally {
      layer.destroy();
    }
  });

  it('сохраняет три отдельные фишки и их вертикальный шаг на общем переходе', () => {
    const { view: source, width } = sourceView();
    const original = source.units[0];
    if (!original) throw new Error('Свой отряд не найден');
    const next = neighbors(hexFromId(original.hex, width))[0];
    if (!next) throw new Error('Соседний гекс не найден');
    const target = hexId(next, width);
    const units = [
      { ...original, id: original.id, type: 'infantry' as const, soldiers: (1250 * FP) as Fp },
      { ...original, id: original.id + 1, type: 'armor' as const, soldiers: (620 * FP) as Fp },
      { ...original, id: original.id + 2, type: 'artillery' as const, soldiers: (180 * FP) as Fp },
    ].map((unit) => ({
      ...unit,
      path: [target],
      moveTotal: 10,
      moveTicks: 4,
    }));
    const layer = createUnitLayer(width, tokens.map.hexRadius, (hex) =>
      hexCenter(hexFromId(hex, width), tokens.map.hexRadius),
    );
    try {
      layer.setView({ ...source, units }, { hex: null, units: [], target: null }, 0);
      layer.frame(50);

      const chipsLayer = layer.container.children[0];
      if (!chipsLayer) throw new Error('Слой фишек не найден');
      const roots = chipsLayer.children.slice(1);
      expect(roots).toHaveLength(3);
      const ordered = [...roots].sort((a, b) => a.position.y - b.position.y);
      const first = ordered[0];
      const second = ordered[1];
      const third = ordered[2];
      if (!first || !second || !third) throw new Error('Стопка не содержит три фишки');
      const screenY = screenYPositions(ordered);
      const firstY = screenY[0];
      const secondY = screenY[1];
      const thirdY = screenY[2];
      if (firstY === undefined || secondY === undefined || thirdY === undefined)
        throw new Error('Экранные координаты перехода не найдены');
      expect(secondY - firstY).toBeCloseTo(CHIP_STACK_STEP);
      expect(thirdY - secondY).toBeCloseTo(CHIP_STACK_STEP);
      const from = hexCenter(hexFromId(original.hex, width), tokens.map.hexRadius);
      expect(
        Math.hypot(first.position.x - from.x, first.position.y - from.y + CHIP_STACK_STEP),
      ).toBeGreaterThan(0);
      const labels = ordered.map((root) => {
        const content = root.children[0];
        const graphic = content?.children[0];
        const label = content?.children[1];
        if (!(graphic instanceof Graphics) || !(label instanceof BitmapText))
          throw new Error('Примитивы фишки не найдены');
        return { label: label.text, graphic: graphicSignature(graphic) };
      });
      expect(labels.map(({ label }) => label)).toEqual(
        units.map(({ soldiers }) => formatSoldiers(soldiers)),
      );

      const initialX = ordered.reduce((sum, root) => sum + root.position.x, 0) / ordered.length;
      for (const moveTicks of [5, 6, 7]) {
        layer.setView(
          {
            ...source,
            units: units.map((unit) => ({ ...unit, moveTicks })),
          },
          { hex: null, units: [], target: null },
          moveTicks * 100,
        );
        const updatedRoots = chipsLayer.children.slice(1);
        expect(updatedRoots).toHaveLength(3);
        const updated = [...updatedRoots].sort((a, b) => a.position.y - b.position.y);
        const [low, middle, high] = updated;
        if (!low || !middle || !high) throw new Error('Переход потерял фишку отряда');
        const screenY = screenYPositions(updated);
        const lowY = screenY[0];
        const middleY = screenY[1];
        const highY = screenY[2];
        if (lowY === undefined || middleY === undefined || highY === undefined)
          throw new Error('Экранные координаты перехода не найдены');
        expect(middleY - lowY).toBeCloseTo(CHIP_STACK_STEP);
        expect(highY - middleY).toBeCloseTo(CHIP_STACK_STEP);
        const frameData = updated.map((root) => {
          const content = root.children[0];
          const graphic = content?.children[0];
          const label = content?.children[1];
          if (!(graphic instanceof Graphics) || !(label instanceof BitmapText))
            throw new Error('Кадр перехода потерял примитив фишки');
          return { label: label.text, graphic: graphicSignature(graphic) };
        });
        expect(frameData).toEqual(labels);
        expect(
          updated.reduce((sum, root) => sum + root.position.x, 0) / updated.length,
        ).toBeGreaterThan(initialX);
      }
    } finally {
      layer.destroy();
    }
  });
});
