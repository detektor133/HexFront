import { describe, expect, it } from 'vitest';

import { playerView } from '../src/queries/player-view.ts';
import type { MatchState } from '../src/state/types.ts';
import { step } from '../src/step.ts';
import { city, scenario } from './scenario/dsl.ts';

function stateWithHold(): MatchState & { holdPlayer: number; holdTicks: number } {
  const s = scenario(
    `
      A1  A2  A3  B1  .  .  .
    `,
    {
      legend: {
        A1: city('A', 1, { capital: true }),
        A2: city('A', 1),
        A3: city('A', 1),
        B1: city('B', 1, { capital: true }),
      },
    },
  );
  const state = s.state as MatchState & { holdPlayer: number; holdTicks: number };
  state.holdPlayer = 0;
  state.holdTicks = 20;
  return state;
}

describe('victoryHold в playerView', () => {
  it('критерий: игрок, держащий ≥ 70 % городов, попадает в victoryHold', () => {
    const view = playerView(stateWithHold(), 0) as typeof playerView extends (
      ...args: never[]
    ) => infer R
      ? R & { victoryHold: { player: number; seconds: number } | null }
      : never;

    expect(view.victoryHold).toEqual({ player: 0, seconds: 2 });
  });

  it('критерий: при отсутствии игрока, держащего ≥ 70 % городов, victoryHold равен null', () => {
    const state = stateWithHold();
    state.holdPlayer = -1;

    const view = playerView(state, 0) as typeof playerView extends (...args: never[]) => infer R
      ? R & { victoryHold: null }
      : never;

    expect(view.victoryHold).toBeNull();
  });

  it('критерий: секунды убывают на 1 за 10 тиков до 0', () => {
    const state = stateWithHold();
    state.holdTicks = 10;
    const before = playerView(state, 0) as { victoryHold: { seconds: number } };
    for (let tick = 0; tick < 10; tick += 1) step(state, []);

    const after = playerView(state, 0) as { victoryHold: { seconds: number } };

    // 10 тиков / 10 тиков в секунду = минус 1 секунда: 1 - 1 = 0.
    expect(before.victoryHold.seconds - after.victoryHold.seconds).toBe(1);
    expect(after.victoryHold.seconds).toBe(0);
  });
});
