import { describe, expect, it } from 'vitest';

import { city, own, scenario } from './scenario/dsl.ts';
import { planBotActions, type BotWeights } from '../src/bots/brain.ts';
import { createBotTickContext } from '../src/bots/context.ts';
import type { CommandOptionEntry } from '../src/bots/options/types.ts';
import { fp } from '../src/math/int.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
};

describe('динамический мозг бота', () => {
  it('возвращает команды planBotActions без ручного перечисления видов команд', () => {
    const match = scenario('A1 a', { legend, fog: false });
    const player = match.state.players[0];
    if (!player) throw new Error('игрок не создан');
    player.autoReinforce = true;
    const command = { t: 'setTax', rate: fp(0.2) } as const;
    const options: readonly CommandOptionEntry[] = [
      {
        kind: 'setTax',
        options: () => [{ command, group: 'test', effects: { testEffect: fp(1) } }],
      },
    ];

    expect(
      planBotActions(match.state, 0, createBotTickContext(match.state), { testEffect: 1 }, options),
    ).toEqual([command]);
  });

  it('выбирает фиктивный эффект и силу через динамические признаки', () => {
    const match = scenario('A1 a', { legend, fog: false });
    const player = match.state.players[0];
    if (!player) throw new Error('игрок не создан');
    player.autoReinforce = true;
    const command = { t: 'setTax', rate: fp(0.2) } as const;
    const options: readonly CommandOptionEntry[] = [
      {
        kind: 'setTax',
        options: () => [
          {
            command,
            group: 'test',
            effects: { testEffect: fp(1), strength: fp(1) },
          },
        ],
      },
    ];
    const weights: BotWeights = { 'testEffect*threat': 1, 'strength*goldSeconds': 1 };

    expect(
      planBotActions(match.state, 0, createBotTickContext(match.state), weights, options),
    ).toEqual([command]);
  });
});
