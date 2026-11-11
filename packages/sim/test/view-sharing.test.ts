import { describe, expect, it } from 'vitest';

import small from '../../mapgen/maps/small.json' with { type: 'json' };
import { botCommands, commanderCommands } from '../src/bots/run.ts';
import { loadMap } from '../src/map/load.ts';
import { createPlayerViewContext, playerView } from '../src/queries/player-view.ts';
import { createMatch } from '../src/state/create-match.ts';
import { setHexOwner } from '../src/state/hex-owner.ts';
import { step } from '../src/step.ts';

const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const MAP = loaded.map;

const match = (fog: boolean) =>
  createMatch(
    MAP,
    Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })),
    11,
    { fog },
  );

describe('общие слои вида', () => {
  it('слой владельцев делится между игроками и тиками, пока никто не захватил гекс', () => {
    const state = match(true);
    const context = createPlayerViewContext(state);
    const a = playerView(state, 0, context);
    const b = playerView(state, 1, context);
    expect(a.hexes.owner).toBe(b.hexes.owner);
    expect(a.hexes.owner).not.toBe(state.hexes.owner);

    const hex = state.hexes.owner.findIndex((owner) => owner === 0);
    setHexOwner(state, hex, -1);
    const after = playerView(state, 0, createPlayerViewContext(state));
    expect(after.hexes.owner).not.toBe(a.hexes.owner);
    expect(after.hexes.owner[hex]).toBe(-1);
    expect(a.hexes.owner[hex]).toBe(0);
  });

  for (const fog of [true, false]) {
    it(`слои дорог, улучшений и построек совпадают с состоянием или памятью тумана (туман ${fog})`, () => {
      const state = match(fog);
      const bots = state.players.map((p) => p.id);
      let shared = 0;
      let previous: ReturnType<typeof playerView> | null = null;
      for (let tick = 0; tick < 300; tick += 1) {
        step(state, [...commanderCommands(state, bots), ...botCommands(state, bots)]);
        const context = createPlayerViewContext(state);
        for (const id of bots) {
          const view = playerView(state, id, context);
          const road = fog ? state.vision?.road[id] : state.hexes.road;
          const building = fog ? state.vision?.building[id] : state.hexes.building;
          const improvement = fog ? state.vision?.improvement[id] : state.hexes.improvement;
          expect([...view.hexes.road]).toEqual([...(road ?? [])]);
          expect([...view.hexes.building]).toEqual([...(building ?? [])]);
          expect([...view.hexes.improvement]).toEqual([...(improvement ?? [])]);
          expect([...view.hexes.owner]).toEqual([...state.hexes.owner]);
          if (id === 0 && previous && view.hexes.road === previous.hexes.road) shared += 1;
          if (id === 0) previous = view;
        }
      }
      // Слой не пересоздаётся каждый тик: большинство тиков отдают ту же копию.
      expect(shared).toBeGreaterThan(100);
    }, 60_000);
  }

  it('повторно используемые слои возвращаются как есть и не считаются заново', () => {
    const state = match(true);
    const context = createPlayerViewContext(state);
    const first = playerView(state, 0, context);
    const reused = playerView(state, 0, context, {
      pop: first.hexes.pop,
      growth: first.hexes.growth,
    });
    expect(reused.hexes.pop).toBe(first.hexes.pop);
    expect(reused.hexes.growth).toBe(first.hexes.growth);
  });
});
