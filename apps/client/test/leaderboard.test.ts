import { describe, expect, it } from 'vitest';

import type { Fp, PlayerView } from '@hexfront/sim';

import { leaderboardRows } from '../src/dev/leaderboard.ts';

const fp = (value: number): Fp => value as Fp;

function view(overrides: Partial<PlayerView>): PlayerView {
  return {
    tick: 0,
    winner: -1,
    playerId: 0,
    hexes: {
      owner: Int16Array.from([0, 0, 1, -1]),
      pop: new Int32Array(4),
      improvement: new Uint8Array(4),
      building: new Uint8Array(4),
      road: new Uint8Array(4),
      link: new Uint8Array(4),
      growth: new Int32Array(4),
      visible: new Uint8Array(4).fill(1),
    },
    cities: [
      {
        id: 1,
        hex: 0,
        owner: 0,
        level: 1,
        name: 'A',
        isCapital: true,
        isolated: false,
        defenders: fp(0),
        defenseOrg: fp(0),
        recruitMax: fp(0),
        canRebuild: false,
      },
      {
        id: 2,
        hex: 2,
        owner: 1,
        level: 1,
        name: 'B',
        isCapital: true,
        isolated: false,
        defenders: fp(0),
        defenseOrg: fp(0),
        recruitMax: fp(0),
        canRebuild: false,
      },
    ],
    units: [
      {
        id: 1,
        owner: 0,
        type: 'infantry',
        soldiers: fp(1500),
        org: fp(0),
        hex: 0,
        order: 'idle',
        target: -1,
        moveTicks: 0,
        moveTotal: 0,
        supplyLevel: fp(1000),
        encircled: false,
        starving: false,
        armyId: null,
        path: [],
        fireTarget: -1,
      },
      {
        id: 2,
        owner: 1,
        type: 'infantry',
        soldiers: fp(700),
        org: fp(0),
        hex: 2,
        order: 'idle',
        target: -1,
        moveTicks: 0,
        moveTotal: 0,
        supplyLevel: null,
        encircled: null,
        starving: null,
        armyId: null,
        path: [],
        fireTarget: -1,
      },
    ],
    armies: [],
    plans: [],
    players: [
      { id: 0, gold: fp(1250), taxTarget: fp(0), taxEffective: fp(0), status: 'alive' },
      { id: 1, gold: fp(0), taxTarget: fp(0), taxEffective: fp(0), status: 'eliminated' },
    ],
    me: {} as PlayerView['me'],
    constructions: [],
    recruits: [],
    ...overrides,
  };
}

describe('таблица лидеров', () => {
  it('считает показатели каждого игрока по снимку', () => {
    expect(leaderboardRows(view({}))).toEqual([
      { playerId: 0, hexes: 2, cities: 1, soldiers: 1500, gold: 1250, status: 'alive' },
      { playerId: 1, hexes: 1, cities: 1, soldiers: 700, gold: 0, status: 'eliminated' },
    ]);
  });

  it('сохраняет игрока без территории, городов и отрядов', () => {
    const rows = leaderboardRows(
      view({
        hexes: { ...view({}).hexes, owner: Int16Array.from([-1, -1, -1, -1]) },
        cities: [],
        units: [],
      }),
    );

    expect(rows[1]).toEqual({
      playerId: 1,
      hexes: 0,
      cities: 0,
      soldiers: 0,
      gold: 0,
      status: 'eliminated',
    });
  });
});
