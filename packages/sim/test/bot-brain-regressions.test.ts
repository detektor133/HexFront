import { describe, expect, it } from 'vitest';

import { at, city, own, scenario } from './scenario/dsl.ts';
import { brainDecide } from '../src/bots/brain.ts';
import { createBotTickContext } from '../src/bots/context.ts';
import { FP, type Fp } from '../src/math/int.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  A2: city('A', 1),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
};

function commandsFor(match: ReturnType<typeof scenario>): ReturnType<typeof brainDecide> {
  return brainDecide(match.state, 0, createBotTickContext(match.state), 'medium', { income: 1 });
}

describe('регрессии мозга бота после перехода на реестр вариантов', () => {
  it('перестраивает снабжение изолированного города', () => {
    const match = scenario(
      `
        a  a  a  a  a  a
        a  A1 a  A2 a  a
        a  a  a  a  a  a
        .  .  .  .  .  B1
      `,
      { legend, fog: false },
    );
    match.player('A').gold = (5000 * FP) as Fp;
    match.runTicks(20);
    const cityId = match.cityAt(at(3, 1))?.id;

    expect(commandsFor(match)).toContainEqual({ t: 'rebuildSupply', cityId });
  });

  it('сохраняет стабильный порядок выбранных команд', () => {
    const match = scenario(
      `
        a  a  a  a  a  a
        a  A1 a  A2 a  a
        a  a  a  a  a  a
        .  .  .  .  .  B1
      `,
      { legend, fog: false },
    );
    match.player('A').gold = (5000 * FP) as Fp;
    const first = commandsFor(match);
    const second = commandsFor(match);

    expect(first).toEqual(second);
  });
});
