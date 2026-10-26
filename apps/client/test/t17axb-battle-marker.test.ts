import { readFileSync } from 'node:fs';

import { BitmapText, Container, GraphicsContext } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { hexFromId, hexId, loadMap, neighbors } from '@hexfront/sim';

import { createUnitLayer } from '../src/dev/unit-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const small = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
) as unknown;

const BODY_SIZE_PX = 24;
const BODY_RADIUS_PX = 12;
const PROTRUSION_LENGTH_PX = 7;
const PROTRUSION_BASE_PX = 10;
const EDGE_OFFSET_PX = 4;

function createBattleView(foreign = false): {
  layer: ReturnType<typeof createUnitLayer>;
  mapWidth: number;
  sourceHex: number;
  targetHex: number;
  secondSourceHex: number;
} {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  const engine = createLocalEngine(small, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const message = engine.tick();
  if (message.t !== 'view') throw new Error('ожидался снимок матча');

  const own = message.view.units.find((unit) => unit.owner === message.view.playerId);
  const enemy = message.view.units.find((unit) => unit.owner !== message.view.playerId);
  if (!own || !enemy) throw new Error('нужны фишки двух сторон');
  const source = hexFromId(own.hex, loaded.map.width);
  const sourceNeighbors = neighbors(source);
  const target = sourceNeighbors[0];
  if (!target) throw new Error('нужен целевой соседний гекс');
  const targetHex = hexId(target, loaded.map.width);
  const secondSource = neighbors(hexFromId(targetHex, loaded.map.width))[1];
  if (!secondSource) throw new Error('нужен второй соседний гекс');
  const secondSourceHex = hexId(secondSource, loaded.map.width);

  const attacker = foreign ? enemy : own;
  const firstAttacker = {
    ...attacker,
    id: attacker.id + 1000,
    order: 'attack' as const,
    target: targetHex,
    attackState: foreign ? null : { target: targetHex, advantage: 42, status: 'success' as const },
  };
  const duplicateAttacker = {
    ...attacker,
    id: attacker.id + 1001,
    order: 'attack' as const,
    target: targetHex,
    attackState: foreign ? null : { target: targetHex, advantage: 42, status: 'success' as const },
  };
  const secondAttacker = {
    ...attacker,
    id: attacker.id + 1002,
    hex: secondSourceHex,
    order: 'attack' as const,
    target: targetHex,
    attackState: foreign ? null : { target: targetHex, advantage: 42, status: 'success' as const },
  };
  const defender = { ...enemy, id: enemy.id + 1000, hex: targetHex };
  const view = {
    ...message.view,
    units: foreign
      ? [firstAttacker, defender]
      : [firstAttacker, duplicateAttacker, secondAttacker, defender],
  };
  const layer = createUnitLayer(loaded.map.width, tokens.map.hexRadius, (hex) =>
    hexCenter(hexFromId(hex, loaded.map.width), tokens.map.hexRadius),
  );
  layer.setView(view, { hex: null, units: [], target: null }, 0);
  return { layer, mapWidth: loaded.map.width, sourceHex: own.hex, targetHex, secondSourceHex };
}

function getBattleLayer(layer: ReturnType<typeof createUnitLayer>): Container {
  const battles = layer.container.children[1];
  if (!(battles instanceof Container)) throw new Error('слой боя не найден');
  return battles;
}

function distance(first: readonly [number, number], second: readonly [number, number]): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function findTriangle(points: number[]): [number, number][] | undefined {
  if (points.length !== 6) return undefined;
  return [
    [points[0] ?? 0, points[1] ?? 0],
    [points[2] ?? 0, points[3] ?? 0],
    [points[4] ?? 0, points[5] ?? 0],
  ];
}

function triangleGeometry(triangle: [number, number][]): {
  direction: [number, number];
  height: number;
} {
  const [firstPoint, secondPoint, thirdPoint] = triangle;
  if (!firstPoint || !secondPoint || !thirdPoint) {
    throw new Error('неполный выступ маркера');
  }
  const sides = [
    { length: distance(firstPoint, secondPoint), first: 0, second: 1, base: 2 },
    { length: distance(secondPoint, thirdPoint), first: 1, second: 2, base: 0 },
    { length: distance(thirdPoint, firstPoint), first: 2, second: 0, base: 1 },
  ];
  const base = sides.find(({ length }) => Math.abs(length - PROTRUSION_BASE_PX) < 0.001);
  if (!base) throw new Error('основание выступа не найдено');
  const tip = triangle[base.base];
  const first = triangle[base.first];
  const second = triangle[base.second];
  if (!tip || !first || !second) throw new Error('неполный выступ маркера');
  const baseCenter: [number, number] = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
  const length = distance(tip, baseCenter);
  return {
    direction: [(tip[0] - baseCenter[0]) / length, (tip[1] - baseCenter[1]) / length],
    height: length,
  };
}

function normalizedDirection(
  source: { x: number; y: number },
  target: { x: number; y: number },
): [number, number] {
  const length = distance([source.x, source.y], [target.x, target.y]);
  return [(target.x - source.x) / length, (target.y - source.y) / length];
}

describe('07/T17axb: направленный маркер боя', () => {
  it('создаёт отдельные маркеры для двух направлений атаки в один гекс', () => {
    const { layer } = createBattleView();
    expect(getBattleLayer(layer).children).toHaveLength(2);
    layer.destroy();
  });

  it('возвращает состояние для прямой пары гексов и не возвращает его для обратной', () => {
    const { layer, sourceHex, targetHex } = createBattleView();

    expect(layer.battleMarkerState(sourceHex, targetHex)).not.toBeNull();
    expect(layer.battleMarkerState(targetHex, sourceHex)).toBeNull();

    layer.destroy();
  });

  it('объединяет несколько отрядов одной пары гексов в один маркер', () => {
    const { layer, mapWidth, sourceHex, targetHex, secondSourceHex } = createBattleView();
    const battles = getBattleLayer(layer);
    const targetCenter = hexCenter(hexFromId(targetHex, mapWidth), tokens.map.hexRadius);
    const sourceCenter = hexCenter(hexFromId(sourceHex, mapWidth), tokens.map.hexRadius);
    const secondSourceCenter = hexCenter(
      hexFromId(secondSourceHex, mapWidth),
      tokens.map.hexRadius,
    );
    const expectedFirst = {
      x:
        (sourceCenter.x + targetCenter.x) / 2 +
        ((sourceCenter.x - targetCenter.x) /
          distance([sourceCenter.x, sourceCenter.y], [targetCenter.x, targetCenter.y])) *
          EDGE_OFFSET_PX,
      y:
        (sourceCenter.y + targetCenter.y) / 2 +
        ((sourceCenter.y - targetCenter.y) /
          distance([sourceCenter.x, sourceCenter.y], [targetCenter.x, targetCenter.y])) *
          EDGE_OFFSET_PX,
    };
    const expectedSecond = {
      x:
        (secondSourceCenter.x + targetCenter.x) / 2 +
        ((secondSourceCenter.x - targetCenter.x) /
          distance(
            [secondSourceCenter.x, secondSourceCenter.y],
            [targetCenter.x, targetCenter.y],
          )) *
          EDGE_OFFSET_PX,
      y:
        (secondSourceCenter.y + targetCenter.y) / 2 +
        ((secondSourceCenter.y - targetCenter.y) /
          distance(
            [secondSourceCenter.x, secondSourceCenter.y],
            [targetCenter.x, targetCenter.y],
          )) *
          EDGE_OFFSET_PX,
    };
    expect(battles.children.map((child) => [child.position.x, child.position.y])).toEqual(
      expect.arrayContaining([
        [expect.closeTo(expectedFirst.x), expect.closeTo(expectedFirst.y)],
        [expect.closeTo(expectedSecond.x), expect.closeTo(expectedSecond.y)],
      ]),
    );
    layer.destroy();
  });

  it('показывает чужой бой направлением без числа преимущества', () => {
    const { layer } = createBattleView(true);
    const marker = getBattleLayer(layer).children[0];
    if (!(marker instanceof Container)) throw new Error('маркер боя не найден');
    expect(marker.children.some((child) => child instanceof BitmapText)).toBe(false);
    layer.destroy();
  });

  it('показывает в локальном маркере целое число преимущества от 0 до 100', () => {
    const { layer } = createBattleView();
    const marker = getBattleLayer(layer).children[0];
    if (!(marker instanceof Container)) throw new Error('маркер боя не найден');
    const number = marker.children.find((child) => child instanceof BitmapText);
    if (!(number instanceof BitmapText)) throw new Error('число преимущества не найдено');
    const advantage = Number(number.text);
    expect(Number.isInteger(advantage)).toBe(true);
    expect(advantage).toBeGreaterThanOrEqual(0);
    expect(advantage).toBeLessThanOrEqual(100);
    layer.destroy();
  });

  it('рисует тело 24×24 с радиусом 12 и выступ длиной 7 с основанием 10 к цели', () => {
    const poly = vi.spyOn(GraphicsContext.prototype, 'poly');
    const circle = vi.spyOn(GraphicsContext.prototype, 'circle');
    const stroke = vi.spyOn(GraphicsContext.prototype, 'stroke');
    const fill = vi.spyOn(GraphicsContext.prototype, 'fill');
    const { layer, mapWidth, sourceHex, targetHex, secondSourceHex } = createBattleView();
    try {
      const triangles = poly.mock.calls
        .map((call) => call[0])
        .filter((value): value is number[] => Array.isArray(value))
        .map(findTriangle)
        .filter((value): value is [number, number][] => value !== undefined);
      const target = hexCenter(hexFromId(targetHex, mapWidth), tokens.map.hexRadius);
      const directions = [
        normalizedDirection(
          hexCenter(hexFromId(sourceHex, mapWidth), tokens.map.hexRadius),
          target,
        ),
        normalizedDirection(
          hexCenter(hexFromId(secondSourceHex, mapWidth), tokens.map.hexRadius),
          target,
        ),
      ];

      expect(circle.mock.calls).toEqual(expect.arrayContaining([[0, 0, BODY_RADIUS_PX]]));
      expect(stroke.mock.calls).toEqual(
        expect.arrayContaining([
          [expect.objectContaining({ width: BODY_SIZE_PX / BODY_RADIUS_PX })],
        ]),
      );
      expect(fill.mock.calls).toEqual(expect.arrayContaining([[tokens.ui.surface]]));
      expect(triangles).toHaveLength(2);
      for (const triangle of triangles) {
        const [firstPoint, secondPoint, thirdPoint] = triangle;
        if (!firstPoint || !secondPoint || !thirdPoint) {
          throw new Error('неполный выступ маркера');
        }
        const geometry = triangleGeometry(triangle);
        expect(geometry.height).toBeCloseTo(PROTRUSION_LENGTH_PX, 5);
        expect(distance(firstPoint, secondPoint)).toBeCloseTo(PROTRUSION_BASE_PX, 5);
        expect(
          directions.some(([x, y]) => geometry.direction[0] * x + geometry.direction[1] * y > 0.99),
        ).toBe(true);
      }

      const localMarker = getBattleLayer(layer).children[0];
      if (!(localMarker instanceof Container)) throw new Error('локальный маркер боя не найден');
      const localNumber = localMarker.children.find((child) => child instanceof BitmapText);
      if (!(localNumber instanceof BitmapText)) throw new Error('число преимущества не найдено');
      expect(localNumber.style.fontFamily).toBe(tokens.font.ui.family);
      expect(localNumber.style.fontWeight).toBe('500');
      expect(localNumber.style.fontSize).toBe(12);

      expect(localNumber.style.fill).toBe(tokens.status.success);
    } finally {
      poly.mockRestore();
      circle.mockRestore();
      stroke.mockRestore();
      fill.mockRestore();
      layer.destroy();
    }
  });

  it('не содержит старую круговую диаграмму организации и перекрещённые клинки', () => {
    const source = readFileSync(new URL('../src/match/battle-marker.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\.arc\s*\(/);
    expect(source).not.toMatch(/battle(?:OrgState|\\u004frgState)/);
    expect(source.match(/\.poly\s*\(/g) ?? []).toHaveLength(1);
  });
});
