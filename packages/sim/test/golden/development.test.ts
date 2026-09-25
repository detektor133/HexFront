import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_TICKS, developmentCommands } from './development-script.ts';
import small from '../../../mapgen/maps/small.json' with { type: 'json' };
import { loadMap } from '../../src/map/load.ts';
import { createMatch } from '../../src/state/create-match.ts';
import { hashState } from '../../src/state/hash.ts';
import { step } from '../../src/step.ts';

interface Result {
  readonly hash: string;
  readonly rejected: number;
  readonly capitalLevel: number;
  readonly improved: number;
}

function run(): Result {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const state = createMatch(loaded.map, [{ name: 'A' }, { name: 'B' }], 42);
  let rejected = 0;
  for (let i = 0; i < DEVELOPMENT_TICKS; i += 1) {
    step(state, developmentCommands(state));
    rejected += state.events.filter((e) => e.t === 'commandRejected').length;
  }
  const capital = state.cities.find((c) => c.id === state.players[0]?.capitalCityId);
  return {
    hash: hashState(state),
    rejected,
    capitalLevel: capital?.level ?? 0,
    improved: state.hexes.improvement.reduce((sum, level) => sum + level, 0),
  };
}

describe('golden-реплей «10 минут развития без войны» на small', () => {
  const result = run();

  // Без отрядов территория не растёт (захват — этап 03), поэтому места для нового города нет:
  // сценарий улучшает столицу и благоустраивает гексы вокруг неё.
  it('сценарий отдаёт только допустимые команды, улучшает столицу и благоустраивает гексы', () => {
    expect(result.rejected).toBe(0);
    expect(result.capitalLevel).toBeGreaterThan(1);
    expect(result.improved).toBeGreaterThan(0);
  });

  it('конечное состояние совпадает с эталоном', () => {
    // Эталон правил этапа 02; меняется только вместе с решением в DECISIONS.md.
    expect(result.hash).toBe('e0a7cd15');
  });

  it('повторный прогон даёт тот же хэш', () => {
    expect(run().hash).toBe(result.hash);
  });
});
