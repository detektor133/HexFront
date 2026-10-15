import { describe, expect, it } from 'vitest';

import { playerPlaces, playerScores, playerView, type PlayerView } from '../src/index.ts';
import { at, city, scenario } from './scenario/dsl.ts';

type RankingView = PlayerView & {
  readonly ranking: readonly {
    readonly id: number;
    readonly score: number;
    readonly place: number;
  }[];
};

describe('ranking в playerView', () => {
  it('критерий: ranking совпадает с playerPlaces и playerScores под туманом, когда отряды соперника не видны', () => {
    const match = scenario(
      `
      A  .  .  .  .  .  .  .  .
      .  .  .  .  .  .  .  .  .
      .  .  .  .  .  .  .  .  B
      `,
      {
        legend: {
          A: city('A', 1, { capital: true }),
          B: city('B', 1, { capital: true }),
        },
      },
    );
    match.unit('B', 'infantry', 100, at(7, 2));
    match.runTicks(1);

    const scores = playerScores(match.state);
    const places = playerPlaces(match.state, scores);
    const view = playerView(match.state, 0) as RankingView;

    expect(view.units.some((unit) => unit.owner === 1)).toBe(false);
    expect(view.ranking).toEqual(
      Array.from(scores, (score, id) => ({ id, score, place: places[id] })),
    );
  });
});
