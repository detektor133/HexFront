import { describe, expect, it } from 'vitest';

import { city, own, scenario } from './scenario/dsl.ts';
import { brainDecide, planBotActions, type BotWeights } from '../src/bots/brain.ts';
import { createBotTickContext } from '../src/bots/context.ts';
import type { CommandOptionEntry } from '../src/bots/options/types.ts';
import { fp } from '../src/math/int.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
};

const command = { t: 'setTax', rate: fp(0.2) } as const;

function entry(effects: Record<string, ReturnType<typeof fp>>): CommandOptionEntry {
  return { kind: 'setTax', options: () => [{ command, group: 'test', effects }] };
}

describe('мозг бота', () => {
  it('возвращает ровно план вариантов', () => {
    const match = scenario('A1 a', { legend, fog: false });
    const player = match.state.players[0];
    if (!player) throw new Error('игрок не создан');
    player.autoReinforce = true;
    const context = createBotTickContext(match.state);
    const weights: BotWeights = {};

    expect(brainDecide(match.state, 0, context, 'medium', weights)).toEqual(
      planBotActions(match.state, 0, context, weights),
    );
  });

  it('выбирает один вариант в группе с наибольшей положительной оценкой', () => {
    const match = scenario('A1 a', { legend, fog: false });
    const player = match.state.players[0];
    if (!player) throw new Error('игрок не создан');
    player.autoReinforce = true;
    const first = { t: 'setTax', rate: fp(0.1) } as const;
    const second = { t: 'setTax', rate: fp(0.2) } as const;
    const options: readonly CommandOptionEntry[] = [
      {
        kind: 'setTax',
        options: () => [
          { command: first, group: 'tax', effects: { score: fp(1) } },
          { command: second, group: 'tax', effects: { score: fp(2) } },
        ],
      },
    ];

    expect(
      planBotActions(match.state, 0, createBotTickContext(match.state), { score: 1 }, options),
    ).toEqual([second]);
  });

  it('не выполняет платный вариант при нехватке золота', () => {
    const match = scenario('A1 a', { legend, fog: false });
    const player = match.state.players[0];
    if (!player) throw new Error('игрок не создан');
    player.autoReinforce = true;
    player.gold = fp(10);
    const options = [entry({ cost: fp(-2), testEffect: fp(1) })];

    expect(
      planBotActions(match.state, 0, createBotTickContext(match.state), { testEffect: 1 }, options),
    ).toEqual([]);
  });
});
