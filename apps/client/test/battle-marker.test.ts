import { readFileSync } from 'node:fs';

import { BitmapText, Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { hexFromId, loadMap } from '@hexfront/sim';

import { drawForecastPresentation } from '../src/dev/forecast-plate.ts';
import { createUnitLayer } from '../src/dev/unit-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { battleOrgState, createBattleMarker } from '../src/match/battle-marker.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const small = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
) as unknown;

describe('маркер боя и плашка прогноза (07/T12a)', () => {
  it('4: переводит долю организованности в одно из 8 состояний на границах 0, 12,5, 50 и 100 % и для равных сторон', () => {
    expect(battleOrgState(0, 100)).toBe(0);
    expect(battleOrgState(1000, 7000)).toBe(1);
    expect(battleOrgState(50, 50)).toBe(4);
    expect(battleOrgState(100, 0)).toBe(7);
    expect(battleOrgState(40, 40)).toBe(4);
    expect(battleOrgState(null, null)).toBeNull();
  });

  it('4: при неизменном состоянии маркер не создаёт новых объектов Pixi', () => {
    const marker = createBattleMarker();

    marker.update(4);
    const firstObject = marker.object;
    marker.update(4);

    expect(marker.object).toBe(firstObject);
    marker.update(3);
    marker.update(4);
    expect(marker.object).toBe(firstObject);
    marker.destroy();
  });

  it('4: реальный слой подключает маркер боя к игровому контейнеру', () => {
    const loaded = loadMap(small);
    if (!loaded.ok) throw new Error(loaded.errors.join('; '));
    const engine = createLocalEngine(small, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const message = engine.tick();
    if (message.t !== 'view') throw new Error('ожидался снимок');
    const own = message.view.units.find((unit) => unit.owner === message.view.playerId);
    const enemy = message.view.units.find((unit) => unit.owner !== message.view.playerId);
    if (!own || !enemy) throw new Error('нужны две стороны боя');
    const view = {
      ...message.view,
      units: [
        { ...own, order: 'attack' as const, target: enemy.hex },
        ...message.view.units.filter((unit) => unit.id !== own.id),
      ],
    };
    const layer = createUnitLayer(loaded.map.width, tokens.map.hexRadius, (hex) =>
      hexCenter(hexFromId(hex, loaded.map.width), tokens.map.hexRadius),
    );

    layer.setView(view, { hex: null, units: [], target: null }, 0);

    const battles = layer.container.children[1];
    expect(battles).toBeInstanceOf(Container);
    expect(battles?.children).toHaveLength(1);
    expect(battles?.children[0]).toBeInstanceOf(Container);
    layer.destroy();
  });

  it('4: на карте без наведения есть иконка исхода, но нет карточки плашки', () => {
    const container = new Container();
    drawForecastPresentation(
      container,
      { icon: 'victory', color: '#000000', text: '−28 %' },
      { x: 0, y: 0 },
      1,
      false,
    );
    expect(container.children).toHaveLength(1);
    expect(container.children[0]).toBeInstanceOf(Graphics);
    expect(container.children.some((child) => child instanceof BitmapText)).toBe(false);

    container.destroy({ children: true, context: true });
  });
});
