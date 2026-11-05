import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BUILDING, type PlayerView } from '@hexfront/sim';

import { buildingsList } from '../src/dev/buildings-list.ts';
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

describe('список построек для окна', () => {
  const view = startView();

  it('на старте: своя столица первой с ценой улучшения, складов и укреплений нет', () => {
    const list = buildingsList(view);
    expect(list.cities[0]?.isCapital).toBe(true);
    expect(
      list.cities.every((c) => view.cities.find((x) => x.id === c.id)?.owner === view.playerId),
    ).toBe(true);
    expect(list.cities[0]?.upgradeCost).toBe(100_000);
    expect(list.depots).toEqual([]);
    expect(list.forts).toEqual([]);
  });

  it('склад и укрепление уровня выше первого — со своей ценой улучшения и без неё на максимуме', () => {
    const mine = view.hexes.owner.findIndex(
      (o, id) => o === view.playerId && !view.cities.some((c) => c.hex === id),
    );
    const second = view.hexes.owner.findIndex(
      (o, id) => id > mine && o === view.playerId && !view.cities.some((c) => c.hex === id),
    );
    const building = Uint8Array.from(view.hexes.building);
    building[mine] = BUILDING.fort2;
    building[second] = BUILDING.depot5;
    const list = buildingsList({ ...view, hexes: { ...view.hexes, building } });
    expect(list.forts).toEqual([{ hex: mine, level: 2, upgradeCost: 200_000, busy: false }]);
    expect(list.depots).toEqual([{ hex: second, level: 5, upgradeCost: null, busy: false }]);
  });
});
