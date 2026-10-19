import { readFileSync } from 'node:fs';

import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { fp, hexFromId, hexId, loadMap, neighbors } from '@hexfront/sim';

import { createUnitLayer } from '../src/dev/unit-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { battleOrgState } from '../src/match/battle-marker.ts';
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

describe('07/T17af: маркеры боя по целевому гексу', () => {
  it('рисует один маркер на цель, суммирует атакующих и ставит маркер в центр цели', () => {
    installCanvasStub();
    const loaded = loadMap(small);
    if (!loaded.ok) throw new Error(loaded.errors.join('; '));
    const engine = createLocalEngine(small, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const message = engine.tick();
    if (message.t !== 'view') throw new Error('ожидался снимок матча');

    const own = message.view.units.find((unit) => unit.owner === message.view.playerId);
    const enemy = message.view.units.find((unit) => unit.owner !== message.view.playerId);
    if (!own || !enemy) throw new Error('нужны отряды двух сторон');
    const adjacent = neighbors(hexFromId(own.hex, loaded.map.width));
    const attackerHexB = hexId(adjacent[0] as (typeof adjacent)[number], loaded.map.width);
    const targetA = hexId(adjacent[1] as (typeof adjacent)[number], loaded.map.width);
    const targetB = hexId(adjacent[2] as (typeof adjacent)[number], loaded.map.width);
    const attackerA = {
      ...own,
      id: own.id + 1000,
      org: fp(200),
      order: 'attack' as const,
      target: targetA,
    };
    const attackerB = {
      ...own,
      id: own.id + 1001,
      hex: attackerHexB,
      org: fp(300),
      order: 'attack' as const,
      target: targetA,
    };
    const attackerC = {
      ...own,
      id: own.id + 1002,
      hex: attackerHexB,
      order: 'attack' as const,
      target: targetB,
    };
    const defenderA = { ...enemy, id: enemy.id + 2000, hex: targetA, org: fp(400) };
    const defenderB = { ...enemy, id: enemy.id + 2001, hex: targetB, org: fp(400) };
    const view = {
      ...message.view,
      units: [attackerA, attackerB, attackerC, defenderA, defenderB],
    };
    const layer = createUnitLayer(loaded.map.width, tokens.map.hexRadius, (hex) =>
      hexCenter(hexFromId(hex, loaded.map.width), tokens.map.hexRadius),
    );

    layer.setView(view, { hex: null, units: [], target: null }, 0);

    const battles = layer.container.children[1];
    expect(battles).toBeInstanceOf(Container);
    expect(battles?.children).toHaveLength(2);
    const targetCenterA = hexCenter(hexFromId(targetA, loaded.map.width), tokens.map.hexRadius);
    const targetCenterB = hexCenter(hexFromId(targetB, loaded.map.width), tokens.map.hexRadius);
    expect(battles?.children.map((child) => [child.position.x, child.position.y])).toEqual(
      expect.arrayContaining([
        [targetCenterA.x, targetCenterA.y],
        [targetCenterB.x, targetCenterB.y],
      ]),
    );
    expect(layer.battleMarkerState(targetA)).toBe(
      battleOrgState(attackerA.org + attackerB.org, defenderA.org),
    );
    layer.destroy();
  });
});
