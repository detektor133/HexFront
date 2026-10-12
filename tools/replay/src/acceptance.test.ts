import { describe, expect, it } from 'vitest';

import { calculateBotAcceptance, calculateFitness } from './acceptance.ts';

describe('критерии обучения ботов', () => {
  it('считает максимальные непрерывные интервалы по прямому тик-профилю', () => {
    const ticks = Array.from({ length: 600 }, (_, tick) => ({
      gold: [tick < 12 ? 6000 * 1000 : 0, 0],
      unitSoldiers: [[tick < 25 ? 9 * 1000 : 20 * 1000], []],
    }));

    expect(calculateBotAcceptance(ticks, { winner: 0, winReason: 'cities', endTick: 600 })).toEqual(
      {
        maxGoldOver5000S: 1.2,
        maxUnitUnder10S: 2.5,
        winner: 0,
        winReason: 'cities',
        endTick: 600,
      },
    );
  });

  it('считает целочисленный fitness по таблице критериев', () => {
    expect(
      calculateFitness({
        place: 1,
        maxGoldOver5000S: 120,
        maxUnitUnder10S: 30,
        won: true,
      }),
    ).toBe(6000);
    expect(
      calculateFitness({
        place: 6,
        maxGoldOver5000S: 0,
        maxUnitUnder10S: 0,
        won: false,
      }),
    ).toBe(0);
  });
});
