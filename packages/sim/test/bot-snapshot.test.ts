import { describe, expect, it } from 'vitest';

import { city, own, scenario } from './scenario/dsl.ts';
import europe from '../../mapgen/maps/europe.json' with { type: 'json' };
import { createBotTickContext } from '../src/bots/context.ts';
import { createBotSnapshot } from '../src/bots/snapshot.ts';
import { loadMap } from '../src/map/load.ts';
import { playerView } from '../src/queries/player-view.ts';
import { createMatch } from '../src/state/create-match.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('снимок бота', () => {
  it('совпадает с расчётами playerView для экономики и свободных городов', () => {
    const match = scenario(
      `
        A1 a B1 b
        a  a  b  b
      `,
      { legend, fog: false },
    );
    match.unit('A', 'infantry', 80, { col: 1, row: 0 });
    const context = createBotTickContext(match.state);
    const snapshot = createBotSnapshot(match.state, 0, context);
    const view = playerView(match.state, 0, context.playerView);

    expect(snapshot.gold).toBe(view.players[0]?.gold);
    expect(snapshot.incomePerS).toBe(view.me.incomePerS);
    expect(snapshot.upkeepPerS).toBe(view.me.upkeepPerS);
    expect(snapshot.freeCities).toEqual(
      view.cities
        .filter((cityView) => cityView.owner === 0 && cityView.recruitMax > 0)
        .map((cityView) => cityView.id),
    );
    expect(snapshot.contacts).toEqual([{ enemy: 1, mine: 80000, theirs: 0 }]);
  });

  it('не учитывает вражеский отряд вне обзора', () => {
    const match = scenario(
      `
        A1 a  .  .  .  .  b  B1
        a  a  .  .  .  .  b  b
      `,
      { legend },
    );
    const initial = createBotSnapshot(match.state, 0, createBotTickContext(match.state));
    match.unit('B', 'infantry', 120, { col: 5, row: 0 });
    const snapshot = createBotSnapshot(match.state, 0, createBotTickContext(match.state));

    expect(snapshot.contacts).toEqual([]);
    expect(snapshot).toEqual(initial);
  });

  it('совпадает с playerView на карте для 30 игроков после 600 и 3000 тиков', () => {
    const loaded = loadMap(europe);
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    const state = createMatch(
      loaded.map,
      Array.from({ length: 30 }, (_, id) => ({ name: `P${id}` })),
      43,
    );
    for (const targetTick of [600, 3000]) {
      state.tick = targetTick;
      const context = createBotTickContext(state);
      const snapshot = createBotSnapshot(state, 0, context);
      const view = playerView(state, 0, context.playerView);
      expect(snapshot.gold).toBe(view.players[0]?.gold);
      expect(snapshot.incomePerS).toBe(view.me.incomePerS);
      expect(snapshot.upkeepPerS).toBe(view.me.upkeepPerS);
      expect(snapshot.freeCities).toEqual(
        view.cities
          .filter((cityView) => cityView.owner === 0 && cityView.recruitMax > 0)
          .map((cityView) => cityView.id),
      );
    }
  });
});
