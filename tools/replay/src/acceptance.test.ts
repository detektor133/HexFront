import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { calculateBotAcceptance, calculateFitness } from './acceptance.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  FP,
  loadMap,
  step,
} from '../../../packages/sim/src/index.ts';

describe('критерии обучения ботов', () => {
  it('считает интервалы матча на сиде 42 прямым перебором его тиков', () => {
    const map = loadMap(
      JSON.parse(
        readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
      ),
    );
    if (!map.ok) throw new Error(map.errors.join('\n'));
    const state = createMatch(
      map.map,
      Array.from({ length: 6 }, (_, id) => ({ name: `P${id}` })),
      42,
      { fog: false },
    );
    const bots = state.players.map((player) => player.id);
    const ticks = [];
    const goldRuns = new Array<number>(bots.length).fill(0);
    const unitRuns = new Array<number>(bots.length).fill(0);
    const maxGoldRuns = new Array<number>(bots.length).fill(0);
    const maxUnitRuns = new Array<number>(bots.length).fill(0);
    for (let tick = 0; tick < 600; tick += 1) {
      const context = createBotTickContext(state);
      step(state, [
        ...commanderCommands(state, bots, context),
        ...botCommands(state, bots, context),
      ]);
      ticks.push({
        gold: state.players.map((player) => player.gold),
        unitSoldiers: state.players.map((player) =>
          state.units.filter((unit) => unit.owner === player.id).map((unit) => unit.soldiers),
        ),
      });
      for (let playerId = 0; playerId < bots.length; playerId += 1) {
        const player = state.players[playerId];
        const units = ticks.at(-1)?.unitSoldiers[playerId] ?? [];
        goldRuns[playerId] = (player?.gold ?? 0) > 5000 * FP ? (goldRuns[playerId] ?? 0) + 1 : 0;
        unitRuns[playerId] = units.some((soldiers) => soldiers < 10 * FP)
          ? (unitRuns[playerId] ?? 0) + 1
          : 0;
        maxGoldRuns[playerId] = Math.max(maxGoldRuns[playerId] ?? 0, goldRuns[playerId] ?? 0);
        maxUnitRuns[playerId] = Math.max(maxUnitRuns[playerId] ?? 0, unitRuns[playerId] ?? 0);
      }
    }

    const actual = calculateBotAcceptance(ticks, {
      winner: state.winner,
      winReason: null,
      endTick: state.tick,
    });
    expect(actual.maxGoldOver5000S).toBe(Math.max(...maxGoldRuns) / 10);
    expect(actual.maxUnitUnder10S).toBe(Math.max(...maxUnitRuns) / 10);
    expect(actual.goldOver5000SByPlayer).toEqual(maxGoldRuns.map((ticks) => ticks / 10));
    expect(actual.unitUnder10SByPlayer).toEqual(maxUnitRuns.map((ticks) => ticks / 10));
    expect(actual.endTick).toBe(600);
  });

  it('считает целочисленный fitness по таблице критериев', () => {
    const penalties = [
      [0, 0, 0, 0],
      [120, 0, 30, 0],
      [220, 72, 130, 68],
      [700, 420, 700, 455],
      [1500, 1000, 1500, 1000],
    ] as const;
    for (const [goldSeconds, expectedGoldPenalty, unitSeconds, expectedUnitPenalty] of penalties) {
      expect(
        calculateFitness({
          place: 6,
          maxGoldOver5000S: goldSeconds,
          maxUnitUnder10S: 0,
          won: false,
          cities: 0,
          totalCities: 10,
        }),
      ).toBe(expectedGoldPenalty === 0 ? 0 : -expectedGoldPenalty);
      expect(
        calculateFitness({
          place: 6,
          maxGoldOver5000S: 0,
          maxUnitUnder10S: unitSeconds,
          won: false,
          cities: 0,
          totalCities: 10,
        }),
      ).toBe(expectedUnitPenalty === 0 ? 0 : -expectedUnitPenalty);
    }
    expect(
      calculateFitness({
        place: 1,
        maxGoldOver5000S: 120,
        maxUnitUnder10S: 30,
        won: true,
        cities: 0,
        totalCities: 10,
      }),
    ).toBe(8000);
    expect(
      calculateFitness({
        place: 6,
        maxGoldOver5000S: 0,
        maxUnitUnder10S: 0,
        won: false,
        cities: 0,
        totalCities: 10,
      }),
    ).toBe(0);
    expect(
      calculateFitness({
        place: 1,
        maxGoldOver5000S: 1500,
        maxUnitUnder10S: 1500,
        won: false,
        cities: 0,
        totalCities: 10,
      }),
    ).toBe(3000);
    expect(
      calculateFitness({
        place: 6,
        maxGoldOver5000S: 1500,
        maxUnitUnder10S: 0,
        won: true,
        cities: 0,
        totalCities: 10,
      }),
    ).toBe(2000);

    const progress = {
      place: 6,
      maxGoldOver5000S: 0,
      maxUnitUnder10S: 0,
      won: false,
      totalCities: 20,
    };
    expect(calculateFitness({ ...progress, cities: 0 })).toBe(0);
    expect(calculateFitness({ ...progress, cities: 7 })).toBe(1500);
    expect(calculateFitness({ ...progress, cities: 14 })).toBe(3000);
    expect(calculateFitness({ ...progress, cities: 20 })).toBe(3000);
  });
});
