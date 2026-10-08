import { describe, expect, it } from 'vitest';

import type { Fp, PlayerView } from '@hexfront/sim';

import {
  decodeDelta,
  decodeSnapshot,
  encodeDelta,
  encodeSnapshot,
  type DeltaMessage,
  type SnapshotMessage,
} from '../src/index.ts';

const view = (): PlayerView => ({
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
  units: [],
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
});

describe('кодеки снимков', () => {
  it('восстанавливает полный снимок с типизированными массивами', () => {
    const message: SnapshotMessage = { t: 'snapshot', tick: 7, view: view() };

    const decoded = decodeSnapshot(encodeSnapshot(message));

    expect(decoded).toEqual(message);
    expect(decoded.view.hexes.owner).toBeInstanceOf(Int16Array);
    expect(decoded.view.hexes.pop).toBeInstanceOf(Int32Array);
  });

  it('сохраняет изменения фронта и события в дельте', () => {
    const message: DeltaMessage = {
      t: 'delta',
      baseTick: 7,
      tick: 8,
      d: {
        hexes: [{ id: 1, owner: 0 }],
        units: { upsert: [], removed: [11] },
        fronts: { upsert: [], removed: [4] },
        events: [{ t: 'playerEliminated', playerId: 1 }],
      },
    };

    expect(decodeDelta(encodeDelta(message), 7)).toEqual(message);
  });

  it('отклоняет дельту с неверной подтверждённой базой', () => {
    const message: DeltaMessage = {
      t: 'delta',
      baseTick: 6,
      tick: 8,
      d: {
        hexes: [],
        units: { upsert: [], removed: [] },
        fronts: { upsert: [], removed: [] },
        events: [],
      },
    };

    expect(() => decodeDelta(encodeDelta(message), 7)).toThrow('Неверная база дельты');
  });
});
