import { describe, expect, it } from 'vitest';

import type { Fp, PlayerView, UnitView } from '@hexfront/sim';

import { decodeSnapshot, encodeSnapshot, type SnapshotMessage } from '../src/index.ts';

const attackState = {
  target: 3,
  advantage: 86,
  status: 'success' as const,
};

function view(): PlayerView {
  const unit: UnitView = {
    id: 10,
    owner: 0,
    type: 'infantry',
    soldiers: 600 as Fp,
    org: 1000 as Fp,
    hex: 2,
    order: 'attack',
    inBattle: true,
    target: 3,
    moveTicks: 0,
    moveTotal: 0,
    supplyLevel: 1000 as Fp,
    encircled: false,
    starving: false,
    armyId: null,
    path: [],
    fireTarget: -1,
    artillerySupport: false,
    ...({ attackState } as Record<string, unknown>),
  } as UnitView;

  return {
    tick: 7,
    winner: -1,
    playerId: 0,
    hexes: {
      owner: Int16Array.from([0, -1]),
      pop: Int32Array.from([1000, 0]),
      improvement: Uint8Array.from([1, 0]),
      building: Uint8Array.from([0, 0]),
      road: Uint8Array.from([1, 0]),
      link: Uint8Array.from([1, 0]),
      growth: Int32Array.from([2, 0]),
      visible: Uint8Array.from([1, 1]),
    },
    cities: [],
    units: [unit],
    armies: [],
    plans: [],
    players: [],
    me: {
      popTotal: 1000,
      popGrowthPerS: 2,
      incomePerS: 0,
      incomeAtTargetPerS: 0,
      upkeepPerS: 0,
      supplyLevel: 1000 as Fp,
      bankrupt: false,
      autoReinforce: true,
      autoCommand: true,
      foundCityCost: 0 as Fp,
      growthMultAtTarget: 1000 as Fp,
      score: 0,
      place: 1,
      players: 1,
    },
    constructions: [],
    recruits: [],
  };
}

describe('07/T17axa: состояние атаки в протоколе', () => {
  it('сохраняет локальную оценку атаки в snapshot round-trip', () => {
    const message: SnapshotMessage = { t: 'snapshot', tick: 7, view: view() };
    const decoded = decodeSnapshot(encodeSnapshot(message));
    const unit = decoded.view.units[0] as unknown as { attackState: typeof attackState };

    expect(unit.attackState).toEqual(attackState);
  });
});
