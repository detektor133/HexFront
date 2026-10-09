import { describe, expect, it } from 'vitest';

import { city, own, scenario } from './scenario/dsl.ts';
import { brainDecide, planBotActions, type BotWeights } from '../src/bots/brain.ts';
import { createBotTickContext } from '../src/bots/context.ts';
import type { BotTickContext } from '../src/bots/context.ts';
import {
  COMMAND_OPTIONS,
  DEFAULT_BOT_OPTION_DEFINITIONS,
  type BotOptionDefinitions,
} from '../src/bots/options/index.ts';
import type { CommandOptionEntry } from '../src/bots/options/types.ts';
import { createBotSnapshot } from '../src/bots/snapshot.ts';
import { fp } from '../src/math/int.ts';
import type { MatchState } from '../src/state/types.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
};

describe('динамический мозг бота', () => {
  it('возвращает команды planBotActions без ручного перечисления видов команд', () => {
    const match = scenario('A1 a', { legend, fog: false });
    const player = match.state.players[0];
    if (!player) throw new Error('игрок не создан');
    player.gold = fp(1000);
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

  it('выбирает фиктивный вариант и новый тип юнита через реестр', () => {
    const match = scenario(
      `
        a a A1 b b
      `,
      {
        legend: {
          A1: city('A', 1, { capital: true }),
          a: own('A'),
          b: own('B'),
        },
        fog: false,
      },
    );
    const player = match.state.players[0];
    if (!player) throw new Error('игрок не создан');
    player.gold = fp(1000);
    player.autoReinforce = true;
    match.unit('A', 'infantry', 100, { col: 2, row: 0 });
    match.unit('B', 'infantry', 100, { col: 3, row: 0 });
    const definitions: BotOptionDefinitions = {
      ...DEFAULT_BOT_OPTION_DEFINITIONS,
      units: {
        ...DEFAULT_BOT_OPTION_DEFINITIONS.units,
        scouts: {
          costGoldPerSoldier: fp(0.2),
          upkeepGoldPerSoldierS: fp(0.004),
          upkeepGoldPerUnitS: fp(0.05),
          attack: fp(20),
          defense: fp(20),
          supplyPerSoldier: fp(0.5),
        },
      },
    };
    const command = { t: 'setTax', rate: fp(0.2) } as const;
    const options: readonly CommandOptionEntry[] = [
      ...COMMAND_OPTIONS,
      {
        kind: 'setTax',
        options: (
          _state: MatchState,
          _playerId: number,
          _context: BotTickContext,
          passedDefinitions: BotOptionDefinitions,
        ) => {
          const fakeUnit = passedDefinitions.units.scouts;
          if (!fakeUnit) return [];
          return [
            {
              command,
              group: 'test',
              effects: { testEffect: fp(1), strength: fakeUnit.attack },
            },
          ];
        },
      },
    ];
    const weights: BotWeights = {
      testEffect: 1,
      'strength*threat': 1,
    };
    const context = createBotTickContext(match.state);
    expect(createBotSnapshot(match.state, 0, context).threat).toBeGreaterThan(0);

    const planned = planBotActions(match.state, 0, context, weights, options, definitions);

    expect(planned).toContain(command);
    expect(
      brainDecide(match.state, 0, createBotTickContext(match.state), 'medium', weights),
    ).toEqual(planBotActions(match.state, 0, createBotTickContext(match.state), weights));
  });
});
