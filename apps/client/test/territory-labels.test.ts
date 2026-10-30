import { Container, Text } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installTextCanvasStub } from './text-canvas.ts';
import {
  buildTerritoryLabels,
  territoryLabelsKey,
  drawTerritoryLabels,
} from '../src/dev/territory-labels.ts';
import { setPlayerPalette } from '../src/theme/colors.ts';
import { tokens } from '../src/theme/tokens.ts';

describe('подписи территорий', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setPlayerPalette(null);
  });

  it('строит один центроид на владельца и пропускает нейтральные гексы и игроков без территории', () => {
    const labels = buildTerritoryLabels(
      {
        hexes: { owner: Int16Array.from([0, 0, 1, -1]) },
        players: [
          { id: 0, name: 'Север' },
          { id: 1, name: 'Юг' },
          { id: 2, name: 'Без земли' },
        ],
      } as never,
      2,
      10,
    );

    expect(labels).toHaveLength(2);
    expect(labels.map((label) => label.name)).toEqual(['Север', 'Юг']);
    expect(labels[0]?.at).toEqual({ x: 7.5, y: -4.330127018922193 });
    expect(labels[1]?.at).toEqual({ x: 0, y: 17.32050807568877 });
  });

  it('увеличивает размер подписи с территорией и ограничивает его токенами шрифта', () => {
    const labels = buildTerritoryLabels(
      {
        hexes: { owner: Int16Array.from([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]) },
        players: [
          { id: 0, name: 'Малая' },
          { id: 1, name: 'Большая' },
        ],
      } as never,
      4,
      10,
    );

    expect(labels[0]?.fontSize).toBeGreaterThanOrEqual(12);
    expect(labels[1]?.fontSize).toBeGreaterThan(labels[0]?.fontSize ?? 0);
    expect(labels[1]?.fontSize).toBeLessThanOrEqual(24);
    expect(labels[0]?.fontSize).toBeGreaterThanOrEqual(12);
  });

  it('меняет ключ кэша, когда размер территории меняет размер подписи при прежнем центроиде', () => {
    const view = (owner: number[]): Parameters<typeof buildTerritoryLabels>[0] =>
      ({ hexes: { owner: Int16Array.from(owner) }, players: [{ id: 0, name: 'Север' }] }) as never;
    const smaller = buildTerritoryLabels(view([0, -1, -1, 0]), 2, 10);
    const larger = buildTerritoryLabels(view([0, 0, 0, 0]), 2, 10);

    expect(larger[0]?.at).toEqual(smaller[0]?.at);
    expect(territoryLabelsKey(larger, 1, 1)).not.toBe(territoryLabelsKey(smaller, 1, 1));
  });

  it('окрашивает подпись цветом линии из палитры игрока', () => {
    installTextCanvasStub();
    const player = tokens.players.palette[1];
    expect(player).toBeDefined();
    if (!player) return;
    const container = new Container();
    drawTerritoryLabels(
      container,
      [{ playerId: 1, name: 'Юг', at: { x: 0, y: 0 }, fontSize: 12, maxWidth: 100 }],
      1,
      1,
    );

    const label = container.children[0];
    expect(label).toBeInstanceOf(Text);
    expect((label as Text).style.fill).toBe(player.line);
    container.destroy({ children: true });
  });

  it('сохраняет короткую подпись и уменьшает длинную до ширины территории', () => {
    installTextCanvasStub();
    const labels = buildTerritoryLabels(
      {
        hexes: { owner: Int16Array.from([0, -1, 1, -1]) },
        players: [
          { id: 0, name: 'ЮЮ' },
          { id: 1, name: 'Очень длинное название государства' },
        ],
      } as never,
      2,
      10,
    );
    const short = labels[0];
    const long = labels[1];

    expect(short).toBeDefined();
    expect(long).toBeDefined();
    const container = new Container();
    drawTerritoryLabels(container, labels, 1, 1);
    const drawn = container.children.filter((child): child is Text => child instanceof Text);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]?.width).toBeLessThanOrEqual(short?.maxWidth ?? 0);
    expect(drawn[1]?.width).toBeLessThanOrEqual(long?.maxWidth ?? 0);
    expect(drawn[0]?.scale.x).toBeLessThan(1);
    expect(drawn[1]?.scale.x).toBeLessThan(1);
    container.destroy({ children: true });
  });
});
