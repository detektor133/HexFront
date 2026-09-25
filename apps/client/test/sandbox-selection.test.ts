import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { PlayerView } from '@hexfront/sim';

import {
  attackCommand,
  isHostile,
  NOTHING_PICKED,
  orderHex,
  selectHex,
} from '../src/dev/sandbox-selection.ts';
import { lang } from '../src/i18n/dict.ts';
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

describe('песочница: выбор и приказы как в HoI4', () => {
  const view = startView();
  const mine = view.units.filter((u) => u.owner === view.playerId);
  const home = mine[0]?.hex ?? -1;
  const free = view.hexes.owner.findIndex(
    (o, id) => o === view.playerId && id !== home && !isHostile(view, id),
  );

  it('тап по гексу со своими отрядами выбирает их', () => {
    const p = selectHex(view, NOTHING_PICKED, home);
    expect(p.hex).toBe(home);
    expect(p.units).toEqual(mine.filter((u) => u.hex === home).map((u) => u.id));
  });

  it('тап по другому гексу снимает выбор, повторный тап по тем же отрядам — тоже', () => {
    const p = selectHex(view, NOTHING_PICKED, home);
    expect(selectHex(view, p, free)).toEqual({ hex: free, units: [], target: null });
    expect(selectHex(view, p, home).units).toEqual([]);
  });

  it('приказ (долгий тап / ПКМ) по свободному гексу — «идти» выбранным', () => {
    const p = selectHex(view, NOTHING_PICKED, home);
    const next = orderHex(view, p, free);
    expect(next.cmd).toEqual({ t: 'move', unitIds: p.units, to: free });
    expect(next.picked.units).toEqual(p.units);
  });

  it('приказ по врагу — прицел атаки, подтверждение даёт attack', () => {
    const p = selectHex(view, NOTHING_PICKED, home);
    const enemy = view.units.find((u) => u.owner !== view.playerId);
    if (!enemy) throw new Error('нет врага');
    const next = orderHex(view, p, enemy.hex);
    expect(next.cmd).toBeNull();
    expect(next.picked.target).toBe(enemy.hex);
    expect(attackCommand(view, next.picked)).toEqual({
      t: 'attack',
      unitIds: p.units,
      target: enemy.hex,
    });
  });

  it('приказ без выбранных отрядов работает как выбор', () => {
    expect(orderHex(view, NOTHING_PICKED, home).cmd).toBeNull();
  });

  it('нейтральный город с гарнизоном — враждебный гекс', () => {
    const neutral = view.cities.find((c) => c.owner < 0);
    expect(neutral && isHostile(view, neutral.hex)).toBe(true);
  });
});

describe('число солдат на фишке (units.md)', () => {
  // Язык берётся из navigator.language: локально — ru, в CI — en; проверяются оба варианта.
  it('850, 1,4к / 1.4k, 12к / 12k — с округлением вниз', () => {
    const [thousand, big] = lang === 'ru' ? ['1,4к', '12к'] : ['1.4k', '12k'];
    expect(formatSoldiers(850_000)).toBe('850');
    expect(formatSoldiers(1_499_000)).toBe(thousand);
    expect(formatSoldiers(12_900_000)).toBe(big);
  });
});
