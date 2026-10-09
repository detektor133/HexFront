import { describe, expect, it } from 'vitest';

import { at, city, own, scenario } from './scenario/dsl.ts';
import { BOT_EASY_TAX, BOT_GOLD_RESERVE, BOT_TAX_PEACE, BOT_TAX_WAR } from '../src/balance.ts';
import { brainDecide } from '../src/bots/brain.ts';
import { createBotTickContext } from '../src/bots/context.ts';
import { FP, type Fp } from '../src/math/int.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  A2: city('A', 1),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const PEACE = `
  a  a  a  a  a  a  a  a  a  .  .  .
  a  a  a  a  a  a  a  a  a  .  .  .
  a  a  a  a  a  a  a  a  a  .  .  .
  a  a  a  A1 a  a  a  a  a  .  .  .
  a  a  a  a  a  a  a  a  a  .  .  .
  a  a  a  a  a  a  a  a  a  .  .  .
  a  a  a  a  a  a  a  a  a  .  .  B1
`;

const FIELD = `
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
  A1 a  a  b  b  b  b  B1
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
`;

function commandsFor(match: ReturnType<typeof scenario>): ReturnType<typeof brainDecide> {
  return brainDecide(match.state, 0, createBotTickContext(match.state));
}

describe('регрессии мозга бота после удаления старой экономики', () => {
  it('выбирает налог мира и включает автопополнение', () => {
    const match = scenario(PEACE, { legend, fog: false });
    const commands = commandsFor(match);

    expect(commands).toContainEqual({ t: 'setTax', rate: BOT_TAX_PEACE });
    expect(commands).toContainEqual({ t: 'setAutoReinforce', on: true });
  });

  it('выбирает налог войны при контакте с врагом', () => {
    const match = scenario(FIELD, { legend, fog: false });

    expect(commandsFor(match)).toContainEqual({ t: 'setTax', rate: BOT_TAX_WAR });
  });

  it('перестраивает снабжение изолированного города', () => {
    const match = scenario(
      `
        a  a  a  a  a  a  a  a  a
        a  A1 a  a  a  a  A2 a  a
        a  a  a  a  a  a  a  a  a
        .  .  .  .  .  .  .  .  B1
      `,
      { legend, fog: false },
    );
    match.player('A').gold = (5000 * FP) as Fp;
    match.runTicks(20);
    const cityId = match.cityAt(at(6, 1))?.id;

    expect(commandsFor(match)).toContainEqual({ t: 'rebuildSupply', cityId });
  });

  it('easy удерживает налог 20 процентов', () => {
    const match = scenario('A1 a B1 b', { legend, fog: false });

    expect(brainDecide(match.state, 0, createBotTickContext(match.state), 'easy')).toContainEqual({
      t: 'setTax',
      rate: BOT_EASY_TAX,
    });
  });

  it('не начинает трату, если цена опустит золото ниже резерва', () => {
    const match = scenario(
      `
        a  a  a  a  a  a  a  a  a
        a  A1 a  a  a  a  A2 a  a
        a  a  a  a  a  a  a  a  a
        .  .  .  .  .  .  .  .  B1
      `,
      { legend, fog: false },
    );
    match.player('A').gold = (BOT_GOLD_RESERVE + 1) as Fp;

    expect(commandsFor(match).filter((command) => command.t === 'rebuildSupply')).toEqual([]);
  });

  it('выбирает не более одного действия для каждого города', () => {
    const match = scenario(
      `
        a  a  a  a  a  a  a  a  a
        a  A1 a  a  a  a  A2 a  a
        a  a  a  a  a  a  a  a  a
        .  .  .  .  .  .  .  .  B1
      `,
      { legend, fog: false },
    );
    match.player('A').gold = (5000 * FP) as Fp;
    const spends = commandsFor(match).filter((command) =>
      ['rebuildSupply', 'recruit', 'upgradeCity'].includes(command.t),
    );

    const cityTargets = spends.map((command) =>
      command.t === 'recruit' || command.t === 'rebuildSupply' || command.t === 'upgradeCity'
        ? command.cityId
        : -1,
    );
    expect(new Set(cityTargets).size).toBe(cityTargets.length);
  });
});
