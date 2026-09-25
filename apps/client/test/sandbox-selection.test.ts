import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { PlayerView } from '@hexfront/sim';

import { attackCommand, isHostile, NOTHING_PICKED, tapHex } from '../src/dev/sandbox-selection.ts';
import { formatSoldiers } from '../src/i18n/format.ts';
import { createLocalEngine } from '../src/local/engine.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);

function startView(): PlayerView {
  const e = createLocalEngine(small, 42, 2);
  if ('errors' in e) throw new Error(e.errors.join('\n'));
  const msg = e.tick();
  if (msg.t !== 'view') throw new Error('ожидался снимок');
  return msg.view;
}

describe('песочница: выбор и приказы кликом', () => {
  const view = startView();
  const mine = view.units.filter((u) => u.owner === view.playerId);
  const home = mine[0]?.hex ?? -1;

  it('тап по гексу со своими отрядами выбирает их', () => {
    const next = tapHex(view, NOTHING_PICKED, home);
    expect(next.cmd).toBeNull();
    expect(next.picked.hex).toBe(home);
    expect(next.picked.units).toEqual(mine.filter((u) => u.hex === home).map((u) => u.id));
  });

  it('следующий тап по свободному гексу — приказ «идти» выбранным', () => {
    const picked = tapHex(view, NOTHING_PICKED, home).picked;
    const free = view.hexes.owner.findIndex(
      (o, id) => o === view.playerId && id !== home && !isHostile(view, id),
    );
    const next = tapHex(view, picked, free);
    expect(next.cmd).toEqual({ t: 'move', unitIds: picked.units, to: free });
    expect(next.picked.units).toEqual(picked.units);
  });

  it('тап по вражескому гексу — прицел атаки без команды, подтверждение даёт attack', () => {
    const picked = tapHex(view, NOTHING_PICKED, home).picked;
    const enemy = view.units.find((u) => u.owner !== view.playerId);
    if (!enemy) throw new Error('нет врага');
    const next = tapHex(view, picked, enemy.hex);
    expect(next.cmd).toBeNull();
    expect(next.picked.target).toBe(enemy.hex);
    expect(attackCommand(view, next.picked)).toEqual({
      t: 'attack',
      unitIds: picked.units,
      target: enemy.hex,
    });
  });

  it('нейтральный город с гарнизоном — враждебный гекс', () => {
    const neutral = view.cities.find((c) => c.owner < 0);
    expect(neutral && isHostile(view, neutral.hex)).toBe(true);
  });

  it('повторный тап по гексу выбранных отрядов снимает выбор отрядов', () => {
    const picked = tapHex(view, NOTHING_PICKED, home).picked;
    expect(tapHex(view, picked, home).picked.units).toEqual([]);
  });
});

describe('число солдат на фишке (units.md)', () => {
  it('850, 1,4к, 12к — с округлением вниз', () => {
    expect(formatSoldiers(850_000)).toBe('850');
    expect(formatSoldiers(1_499_000)).toBe('1,4к');
    expect(formatSoldiers(12_900_000)).toBe('12к');
  });
});
