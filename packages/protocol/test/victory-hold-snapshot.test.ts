import { describe, expect, it } from 'vitest';

import type { Fp, PlayerView } from '@hexfront/sim';

import { decodeSnapshot, encodeSnapshot, type SnapshotMessage } from '../src/index.ts';

const view = (): PlayerView & {
  readonly victoryHold: { readonly player: number; readonly seconds: number } | null;
} =>
  ({
    tick: 100,
    winner: -1,
    playerId: 0,
    victoryHold: { player: 2, seconds: 37 },
    hexes: {
      owner: Int16Array.from([0]),
      pop: Int32Array.from([1000]),
      improvement: Uint8Array.from([0]),
      building: Uint8Array.from([0]),
      road: Uint8Array.from([0]),
      link: Uint8Array.from([0]),
      growth: Int32Array.from([0]),
      visible: Uint8Array.from([1]),
    },
    cities: [],
    units: [],
    armies: [],
    plans: [],
    players: [
      {
        id: 0,
        gold: 1_820_000 as Fp,
        taxTarget: 200 as Fp,
        taxEffective: 200 as Fp,
        status: 'alive',
      },
    ],
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
      score: 0,
      place: 1,
      players: 1,
    },
    constructions: [],
    recruits: [],
  }) as PlayerView & {
    readonly victoryHold: { readonly player: number; readonly seconds: number } | null;
  };

describe('кодек victoryHold', () => {
  it('критерий: кодек protocol передаёт victoryHold без потерь', () => {
    const message: SnapshotMessage = { t: 'snapshot', tick: 100, view: view() };

    expect(decodeSnapshot(encodeSnapshot(message))).toEqual(message);
  });
});
