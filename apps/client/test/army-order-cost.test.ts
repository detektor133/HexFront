import { describe, expect, it } from 'vitest';

import type { ArmyView, MapStatic, PlayerView } from '@hexfront/sim';

import {
  armyResizeCost,
  autoArmy,
  newArmyCost,
  newArmyCounts,
  orderNewArmy,
} from '../src/dev/army-order.ts';

const FP = 1000;

// Карта 4×1: гексы 0,1 — свои (игрок 0), 2,3 — игрока 1.
const map = { width: 4, height: 1 } as unknown as MapStatic;

const army = (id: number, number: number, extra: Partial<ArmyView> = {}): ArmyView => ({
  id,
  number,
  name: '',
  auto: false,
  ...extra,
});

function viewWith(
  armies: ArmyView[],
  units: { hex: number; armyId: number; type?: 'infantry' | 'armor' | 'artillery'; n?: number }[],
  foe = 0,
): PlayerView {
  return {
    playerId: 0,
    players: [
      { id: 0, status: 'alive', gold: 100_000 * FP },
      { id: 1, status: 'alive', gold: 0 },
    ],
    hexes: { owner: [0, 0, 1, 1] },
    armies,
    units: [
      ...units.map((u, id) => ({
        id,
        owner: 0,
        type: u.type ?? 'infantry',
        soldiers: (u.n ?? 100) * FP,
        hex: u.hex,
        armyId: u.armyId,
      })),
      ...(foe > 0
        ? [{ id: 99, owner: 1, type: 'infantry', soldiers: foe * FP, hex: 2, armyId: null }]
        : []),
    ],
    me: { popTotal: 4000 * FP },
  } as unknown as PlayerView;
}

describe('новая армия и цена найма', () => {
  it('новая армия получает состав 75/20/5, а не одну пехоту', () => {
    const counts = newArmyCounts(viewWith([], [], 800), map, 1);
    const total = counts.infantry + counts.armor + counts.artillery;
    expect(counts.armor).toBe(Math.round((total * 20) / 100));
    expect(counts.artillery).toBe(Math.round((total * 5) / 100));
    expect(counts.infantry).toBe(total - counts.armor - counts.artillery);
    const order = orderNewArmy(viewWith([], [], 800), map, 1, 'hold');
    expect(order).toMatchObject({ soldiers: total, mix: { armor: counts.armor } });
  });

  it('цена новой армии считается по составу: броня и артиллерия дороже пехоты', () => {
    const view = viewWith([], [], 800);
    const counts = newArmyCounts(view, map, 1);
    const total = counts.infantry + counts.armor + counts.artillery;
    expect(newArmyCost(view, map, 1)).toBeGreaterThan(Math.round(total * 0.1));
  });

  it('автоподбор называет готовую свободную армию, а при её отсутствии — новую с ценой', () => {
    const free = army(7, 3);
    expect(autoArmy(viewWith([free], []), map, 1, 1)).toEqual({ kind: 'army', army: free });
    const busy: ArmyView = {
      ...army(7, 3),
      dir: { mode: 'hold', target: 0 } as NonNullable<ArmyView['dir']>,
    };
    const auto = autoArmy(viewWith([busy], []), map, 1, 1);
    expect(auto.kind).toBe('new');
  });
});

describe('цена кнопки «+»', () => {
  it('докупается только недостающее по типам', () => {
    const a = army(1, 1, { wanted: 100 });
    // Есть 100 пехоты и нет брони: прирост до 200 по долям 100/0/0 стоит 100 пехоты.
    const view = viewWith([a], [{ hex: 0, armyId: 1 }]);
    expect(armyResizeCost(view, a, 200)).toBe(10);
    // Уже стоящее не оплачивается снова.
    expect(armyResizeCost(view, a, 100)).toBe(0);
  });
});
