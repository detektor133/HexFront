import { readFileSync } from 'node:fs';

import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { hexFromId, hexId, loadMap, neighbors, type PlayerView } from '@hexfront/sim';

import { createUnitLayer } from '../src/dev/unit-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { playerLine } from '../src/theme/colors.ts';
import { tokens } from '../src/theme/tokens.ts';

const small = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
) as unknown;

type Stroke = { readonly color?: string; readonly width?: number; readonly alpha?: number };

function colorHex(value: unknown): string | undefined {
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'number') return `#${value.toString(16).padStart(6, '0')}`;
  return undefined;
}

function lineOf(playerId: number): string {
  return playerLine(playerId).toLowerCase();
}

function installCanvasStub(): void {
  class TestCanvasRenderingContext2D {
    public font = '';

    public scale(_x: number, _y: number): void {}

    public fillText(_text: string, _x: number, _y: number): void {}

    public measureText(value: string): TextMetrics {
      return { width: value.length * 8 } as TextMetrics;
    }
  }
  const context = new TestCanvasRenderingContext2D();
  Object.assign(globalThis, {
    CanvasRenderingContext2D: TestCanvasRenderingContext2D,
    window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) },
    document: { createElement: () => ({ getContext: () => context }) },
  });
}

function groundOf(layer: ReturnType<typeof createUnitLayer>): Graphics {
  const chipsLayer = layer.container.children[0];
  if (!(chipsLayer instanceof Container)) throw new Error('слой фишек не найден');
  const ground = chipsLayer.children[0];
  if (!(ground instanceof Graphics)) throw new Error('слой путей не найден');
  return ground;
}

function strokesOf(ground: Graphics): Stroke[] {
  return ground.context.instructions.flatMap((instruction) => {
    if (instruction.action !== 'stroke') return [];
    const style = instruction.data.style as unknown;
    if (typeof style !== 'object' || style === null) return [];
    const value = style as { color?: unknown; width?: unknown; alpha?: unknown };
    const color = colorHex(value.color);
    const width = typeof value.width === 'number' ? value.width : undefined;
    const alpha = typeof value.alpha === 'number' ? value.alpha : undefined;
    return [
      {
        ...(color === undefined ? {} : { color }),
        ...(width === undefined ? {} : { width }),
        ...(alpha === undefined ? {} : { alpha }),
      },
    ];
  });
}

function movementScene(): {
  readonly layer: ReturnType<typeof createUnitLayer>;
  readonly view: PlayerView;
  readonly selectedId: number;
  readonly ownIds: readonly number[];
  readonly enemyOwner: number;
  readonly mapWidth: number;
} {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  const engine = createLocalEngine(small, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const message = engine.tick();
  if (message.t !== 'view') throw new Error('ожидался снимок матча');

  const own = message.view.units.filter((unit) => unit.owner === message.view.playerId).slice(0, 2);
  const enemy = message.view.units.find((unit) => unit.owner !== message.view.playerId);
  if (own.length !== 2 || !enemy) throw new Error('нужны два своих и один чужой отряд');
  const moving = own.map((unit) => {
    const next = neighbors(hexFromId(unit.hex, loaded.map.width))[0];
    if (!next) throw new Error('для отряда нет соседнего гекса');
    return { ...unit, path: [hexId(next, loaded.map.width)] };
  });
  const enemyNext = neighbors(hexFromId(enemy.hex, loaded.map.width))[0];
  if (!enemyNext) throw new Error('для чужого отряда нет соседнего гекса');
  const view = {
    ...message.view,
    units: [
      ...moving,
      { ...enemy, path: [hexId(enemyNext, loaded.map.width)] },
      ...message.view.units.filter(
        (unit) => !moving.some((candidate) => candidate.id === unit.id) && unit.id !== enemy.id,
      ),
    ],
  } as PlayerView;
  const layer = createUnitLayer(loaded.map.width, tokens.map.hexRadius, (hex) =>
    hexCenter(hexFromId(hex, loaded.map.width), tokens.map.hexRadius),
  );
  return {
    layer,
    view,
    selectedId: moving[0]?.id ?? -1,
    ownIds: moving.map((unit) => unit.id),
    enemyOwner: enemy.owner,
    mapWidth: loaded.map.width,
  };
}

describe('07/T17g: стрелки путей движения', () => {
  it('Приёмка: без выделения пути и наконечники не рисуются, путь чужого отряда не рисуется', () => {
    installCanvasStub();
    const scene = movementScene();
    const ground = groundOf(scene.layer);
    scene.layer.setView(scene.view, { hex: null, units: [], target: null }, 0);
    const strokes = strokesOf(ground);
    const ownStrokes = strokes.filter((stroke) => stroke.color === lineOf(scene.view.playerId));

    expect(scene.ownIds).toHaveLength(2);
    expect(ownStrokes).toHaveLength(0);
    expect(strokes.some((stroke) => stroke.color === lineOf(scene.enemyOwner))).toBe(false);
    scene.layer.destroy();
  });

  it('Приёмка: рисует путь и наконечник только выделенного отряда', () => {
    installCanvasStub();
    const scene = movementScene();
    const ground = groundOf(scene.layer);
    scene.layer.setView(scene.view, { hex: null, units: [scene.selectedId], target: null }, 0);
    const selected = strokesOf(ground).filter(
      (stroke) => stroke.color === lineOf(scene.view.playerId),
    );

    expect(selected).toHaveLength(2);
    expect(selected.every((stroke) => stroke.alpha === 1)).toBe(true);
    scene.layer.destroy();
  });

  it('Приёмка: выбор отряда не меняет линию огня артиллерии', () => {
    installCanvasStub();
    const scene = movementScene();
    const artillery = scene.view.units[0];
    const target = scene.view.units.find((unit) => unit.owner !== scene.view.playerId);
    if (!artillery || !target) throw new Error('нет отрядов для линии огня');
    const view = {
      ...scene.view,
      units: scene.view.units.map((unit) =>
        unit.id === artillery.id
          ? { ...unit, type: 'artillery' as const, path: [], fireTarget: target.id }
          : unit,
      ),
    } as PlayerView;
    const ground = groundOf(scene.layer);
    scene.layer.setView(view, { hex: null, units: [], target: null }, 0);
    const before = strokesOf(ground).filter((stroke) => stroke.color === tokens.status.danger);
    scene.layer.setView(view, { hex: null, units: [artillery.id], target: null }, 0);
    const after = strokesOf(ground).filter((stroke) => stroke.color === tokens.status.danger);

    expect(after).toEqual(before);
    scene.layer.destroy();
  });

  it('Приёмка: линии путей тонкие и используют цвет игрока', () => {
    installCanvasStub();
    const scene = movementScene();
    const ground = groundOf(scene.layer);
    scene.layer.setView(scene.view, { hex: null, units: [scene.selectedId], target: null }, 0);
    const strokes = strokesOf(ground).filter(
      (stroke) => stroke.color === lineOf(scene.view.playerId),
    );

    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every((stroke) => (stroke.width ?? Infinity) <= 2)).toBe(true);
    expect(strokes.every((stroke) => stroke.color === lineOf(scene.view.playerId))).toBe(true);
    scene.layer.destroy();
  });

  it('Приёмка: повторное обновление не увеличивает число стрелок без границ', () => {
    installCanvasStub();
    const scene = movementScene();
    const ground = groundOf(scene.layer);
    const picked = { hex: null, units: [], target: null };
    scene.layer.setView(scene.view, picked, 0);
    const firstCount = strokesOf(ground).length;
    for (let index = 0; index < 50; index += 1) scene.layer.setView(scene.view, picked, index);

    expect(strokesOf(ground)).toHaveLength(firstCount);
    scene.layer.destroy();
  });

  it('T17x: hit-test движущейся фишки использует её текущую позицию', () => {
    installCanvasStub();
    const scene = movementScene();
    const moving = scene.view.units.find((unit) => unit.id === scene.selectedId);
    if (!moving) throw new Error('движущийся отряд не найден');
    const next = moving.path[0];
    if (next === undefined) throw new Error('путь отряда пуст');
    const start = hexCenter(hexFromId(moving.hex, scene.mapWidth), tokens.map.hexRadius);
    const finish = hexCenter(hexFromId(next, scene.mapWidth), tokens.map.hexRadius);
    const view = {
      ...scene.view,
      units: scene.view.units.map((unit) =>
        unit.id === moving.id ? { ...unit, moveTicks: 5, moveTotal: 10 } : unit,
      ),
    } as PlayerView;
    scene.layer.setView(view, { hex: null, units: [], target: null }, 0);
    const midpoint = { x: (start.x + finish.x) / 2, y: (start.y + finish.y) / 2 };

    expect(scene.layer.unitsAt(midpoint)).toContain(scene.selectedId);
    expect(scene.layer.unitsAt(start)).not.toContain(scene.selectedId);
    scene.layer.destroy();
  });
});
