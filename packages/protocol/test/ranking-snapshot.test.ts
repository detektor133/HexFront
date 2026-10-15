import { describe, expect, it } from 'vitest';

import type { Fp, PlayerView } from '@hexfront/sim';

import { decodeSnapshot, encodeSnapshot, type SnapshotMessage } from '../src/index.ts';

const ranking = [
  { id: 2, score: 18, place: 1 },
  { id: 0, score: 12, place: 2 },
  { id: 1, score: 4, place: 3 },
];

const view = (): PlayerView & { readonly ranking: typeof ranking } =>
  ({
    tick: 7,
    winner: -1,
    playerId: 0,
    ranking,
    hexes: {
      owner: Int16Array.from([0, -1]),
      pop: Int32Array.from([1000, 0]),
      improvement: Uint8Array.from([0, 0]),
      building: Uint8Array.from([0, 0]),
      road: Uint8Array.from([0, 0]),
      link: Uint8Array.from([0, 0]),
      growth: Int32Array.from([0, 0]),
      visible: Uint8Array.from([1, 1]),
    },
    cities: [],
    units: [],
    armies: [],
    plans: [],
    players: [],
    me: {
      popTotal: 1000,
      popGrowthPerS: 0,
      incomePerS: 0,
      incomeAtTargetPerS: 0,
      upkeepPerS: 0,
      supplyLevel: 1000 as Fp,
      bankrupt: false,
      autoReinforce: true,
      autoCommand: true,
      foundCityCost: 0 as Fp,
      growthMultAtTarget: 1000 as Fp,
      score: 12,
      place: 2,
      players: 3,
    },
    constructions: [],
    recruits: [],
  }) as PlayerView & { readonly ranking: typeof ranking };

describe('кодек ranking', () => {
  it('критерий: снимок с ranking кодируется и декодируется без потерь', () => {
    const message: SnapshotMessage = { t: 'snapshot', tick: 7, view: view() };

    expect(decodeSnapshot(encodeSnapshot(message))).toEqual(message);
  });
});
