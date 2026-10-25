import { describe, expect, it } from 'vitest';

import { fp, type PlayerView } from '@hexfront/sim';

import { applyHudPreview, readHudPreview } from '../src/dev/hud-preview.ts';

function view(): PlayerView {
  return {
    tick: 1,
    winner: -1,
    playerId: 2,
    hexes: {
      owner: new Int16Array(),
      pop: new Int32Array(),
      improvement: new Uint8Array(),
      building: new Uint8Array(),
      road: new Uint8Array(),
      link: new Uint8Array(),
      growth: new Int32Array(),
      visible: new Uint8Array(),
    },
    cities: [],
    units: [],
    armies: [],
    plans: [],
    players: [
      { id: 1, gold: fp(1), taxTarget: fp(0), taxEffective: fp(0), status: 'alive' },
      { id: 2, gold: fp(2), taxTarget: fp(0), taxEffective: fp(0), status: 'alive' },
    ],
    me: {
      popTotal: 1000,
      popGrowthPerS: 1000,
      incomePerS: 1000,
      incomeAtTargetPerS: 1000,
      upkeepPerS: 0,
      supplyLevel: fp(1),
      bankrupt: false,
      autoReinforce: false,
      autoCommand: false,
      foundCityCost: fp(1),
      growthMultAtTarget: fp(1),
      score: 0,
      place: 1,
      players: 2,
    },
    constructions: [],
    recruits: [],
  };
}

describe('dev-сценарий HUD', () => {
  it('подставляет значения query только текущему игроку', () => {
    const preview = readHudPreview(
      '?hudPop=987654&hudPopRate=12345&hudGold=1234567&hudGoldRate=-2100',
    );
    const result = applyHudPreview(view(), preview);

    expect(result.me).toMatchObject({
      popTotal: 987_654_000,
      popGrowthPerS: 12_345_000,
      incomePerS: 0,
      upkeepPerS: 2_100_000,
    });
    expect(result.players.map(({ gold }) => gold)).toEqual([1000, 1_234_567_000]);
  });

  it('не меняет матч при неполном или некорректном наборе', () => {
    const original = view();
    expect(applyHudPreview(original, readHudPreview('?hudPop=10'))).toBe(original);
    expect(readHudPreview('?hudPop=x&hudPopRate=1&hudGold=2&hudGoldRate=3')).toBeNull();
  });
});
