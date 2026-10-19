import { readFileSync } from 'node:fs';

import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { hexFromId, hexId, loadMap, neighbors } from '@hexfront/sim';

import { createUnitLayer } from '../src/dev/unit-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const small = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
) as unknown;

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

function createBattleScene(): {
  layer: ReturnType<typeof createUnitLayer>;
  mapWidth: number;
  defenderHex: number;
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
  const adjacentEnemyHex = neighbors(hexFromId(own.hex, loaded.map.width))[0];
  if (!adjacentEnemyHex) throw new Error('рядом с фишкой нет гекса');
  const adjacentEnemy = { ...enemy, hex: hexId(adjacentEnemyHex, loaded.map.width) };

  const view = {
    ...message.view,
    units: [
      { ...own, order: 'attack' as const, target: adjacentEnemy.hex },
      ...message.view.units
        .filter((unit) => unit.id !== own.id && unit.id !== enemy.id)
        .concat(adjacentEnemy),
    ],
  };
  const layer = createUnitLayer(loaded.map.width, tokens.map.hexRadius, (hex) =>
    hexCenter(hexFromId(hex, loaded.map.width), tokens.map.hexRadius),
  );

  layer.setView(view, { hex: null, units: [], target: null }, 0);
  return {
    layer,
    mapWidth: loaded.map.width,
    defenderHex: adjacentEnemy.hex,
  };
}

function getBattleAndChipLayers(layer: ReturnType<typeof createUnitLayer>): {
  battles: Container;
  chips: Container;
} {
  const battles = layer.container.children[1];
  if (!(battles instanceof Container)) throw new Error('слой боя не найден');

  const chips = layer.container.children.find(
    (child) => child instanceof Container && child !== battles && child.children.length > 0,
  );
  if (!(chips instanceof Container)) throw new Error('слой фишек не найден');

  return { battles, chips };
}

describe('07/T17f: слой маркера боя', () => {
  it('Приёмка 1: слой маркера боя находится выше слоя фишек', () => {
    const { layer } = createBattleScene();
    const { battles, chips } = getBattleAndChipLayers(layer);

    expect(layer.container.children.indexOf(battles)).toBeGreaterThan(
      layer.container.children.indexOf(chips),
    );

    layer.destroy();
  });

  it('Приёмка 2: фишки рядом с маркером боя не закрывают маркер', () => {
    installCanvasStub();
    const { layer, mapWidth, defenderHex } = createBattleScene();
    const { battles, chips } = getBattleAndChipLayers(layer);
    const marker = battles.children[0];
    if (!(marker instanceof Container)) throw new Error('маркер боя не найден');

    const defenderCenter = hexCenter(hexFromId(defenderHex, mapWidth), tokens.map.hexRadius);
    const adjacentChip = chips.children.find(
      (child) =>
        Math.abs(child.position.x - defenderCenter.x) < 0.001 &&
        Math.abs(child.position.y - defenderCenter.y) < 0.001,
    );
    if (!adjacentChip) throw new Error('соседняя фишка боя не найдена');

    expect(marker.position.x).toBeCloseTo(defenderCenter.x);
    expect(marker.position.y).toBeCloseTo(defenderCenter.y);
    expect(marker.parent).toBe(battles);
    expect(adjacentChip.parent).toBe(chips);

    layer.destroy();
  });
});
