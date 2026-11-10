import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createMatch, loadMap, playerView, step } from '@hexfront/sim';

import { buildViewDelta, ViewDeltaApplier } from '../src/local/view-delta.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);

function newMatch() {
  const loaded = loadMap(small);
  if ('errors' in loaded) throw new Error(loaded.errors.join('\n'));
  return createMatch(loaded.map, [{ name: 'A' }, { name: 'B' }], 7, { fog: true });
}

describe('компактная дельта вида', () => {
  it('чужая казна и налог скрыты, своя видна', () => {
    const state = newMatch();
    step(state, []);
    const view = playerView(state, 0);
    expect(view.players[0]?.gold).toBe(state.players[0]?.gold);
    for (const other of view.players.slice(1)) {
      expect(other.gold).toBe(0);
      expect(other.taxTarget).toBe(0);
      expect(other.taxEffective).toBe(0);
    }
  });

  it('применение дельты даёт тот же вид, а города и игроки идут только изменённые', () => {
    const state = newMatch();
    step(state, []);
    const before = playerView(state, 0);
    step(state, []);
    const after = playerView(state, 0);
    const delta = buildViewDelta(before, after, []);
    expect(delta.d.cities?.upsert.length ?? 0).toBeLessThanOrEqual(after.cities.length);
    const applier = new ViewDeltaApplier();
    applier.applySnapshot({ t: 'snapshot', tick: before.tick, view: before });
    const applied = applier.applyDelta(delta);
    expect(applied.cities).toEqual(after.cities);
    expect(applied.players).toEqual(after.players);
  });
});
