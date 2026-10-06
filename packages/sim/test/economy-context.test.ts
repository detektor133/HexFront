import { describe, expect, it } from 'vitest';

import { city, own, scenario } from './scenario/dsl.ts';
import { createEconomyContext } from '../src/systems/economy-context.ts';
import { incomeBases } from '../src/systems/economy.ts';
import { growthPerSecond } from '../src/systems/population.ts';

describe('общий контекст экономики', () => {
  it('совпадает с независимыми расчётами дохода и роста', () => {
    const s = scenario('A1 a a a', {
      legend: { A1: city('A', 1, { capital: true }), a: own('A') },
    });

    const context = createEconomyContext(s.state);

    expect(context.growth).toEqual(growthPerSecond(s.state));
    expect(context.incomeBases).toEqual(incomeBases(s.state));
  });

  it('сохраняет эквивалентность на нескольких тысячах тиков', () => {
    const s = scenario('A1 a a a', {
      legend: { A1: city('A', 1, { capital: true }), a: own('A') },
    });

    for (let tick = 0; tick < 3000; tick += 1) {
      const context = createEconomyContext(s.state);
      expect(context.growth).toEqual(growthPerSecond(s.state));
      expect(context.incomeBases).toEqual(incomeBases(s.state));
      s.runTicks(1);
    }
  }, 120_000);
});
