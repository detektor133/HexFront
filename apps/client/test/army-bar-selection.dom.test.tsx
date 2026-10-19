import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { ArmyBar } from '../src/dev/ArmyBar.tsx';
import { createUnitLayer } from '../src/dev/unit-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function viewWithTwoArmiesOnOneHex() {
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const source = engine.snapshot().view;
  const own = source.units.filter((unit) => unit.owner === source.playerId).slice(0, 2);
  const firstArmy = source.armies[0];
  if (own.length !== 2 || !firstArmy) {
    throw new Error('Нужны два своих отряда и одна армия');
  }
  const armies = [firstArmy, { ...firstArmy, id: firstArmy.id + 1, number: firstArmy.number + 1 }];
  const units = own.map((unit, index) => ({
    ...unit,
    armyId: armies[index]?.id ?? null,
    hex: own[0]?.hex ?? unit.hex,
    path: [],
    moveTicks: 0,
    moveTotal: 0,
  }));
  return { view: { ...source, units, armies }, armies, units };
}

describe('07/T17aj: выбор армии через панель', () => {
  it('ПКМ по каждой карточке выбирает её armyId и отменяет браузерное меню', () => {
    const { view, armies } = viewWithTwoArmiesOnOneHex();
    const onSelect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
      },
    );

    render(
      createElement(ArmyBar, {
        view,
        selected: null,
        partial: [],
        onSelect,
        send: vi.fn(),
        onPick: vi.fn(),
        tool: null,
        onTool: vi.fn(),
      }),
    );

    const cards = Array.from(document.querySelectorAll<HTMLElement>('[class*="pick"]'));
    expect(cards).toHaveLength(2);
    for (const [index, army] of armies.entries()) {
      const card = cards[index];
      if (!card) throw new Error(`Карточка армии ${army.id} не найдена`);
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      card.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(onSelect).toHaveBeenLastCalledWith(army.id);
    }
  });
});

describe('07/T17aj: выбор фишки на карте', () => {
  it('возвращает оба отряда одной тесной фишки, не различая армии', () => {
    const { view, units } = viewWithTwoArmiesOnOneHex();
    const loaded = loadMap(mapJson);
    if (!loaded.ok) throw new Error(loaded.errors.join('; '));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const layer = createUnitLayer(loaded.map.width, 10, () => ({ x: 0, y: 0 }));
    try {
      layer.setView(view, { hex: null, units: [], target: null }, 0);
      const point = layer.chipAt(units[0]?.hex ?? 0);
      expect(layer.unitsAt(point)).toEqual(units.map((unit) => unit.id));
    } finally {
      layer.destroy();
    }
  });
});
