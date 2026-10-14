import { describe, expect, it } from 'vitest';

import { city, own, scenario } from './scenario/dsl.ts';
import { brainDecide, planBotActions } from '../src/bots/brain.ts';
import { createBotTickContext } from '../src/bots/context.ts';
import type { CommandOptionEntry } from '../src/bots/options/types.ts';
import { botCommands } from '../src/bots/run.ts';
import { fp } from '../src/math/int.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('веса ботов', () => {
  it('выбирает команды по весам своего игрока в одном тике', () => {
    const match = scenario('A1 a B1 b', { legend, fog: false });
    for (const player of match.state.players) player.autoReinforce = true;
    match.state.tick = 0;

    const commands = botCommands(
      match.state,
      [0, 1],
      createBotTickContext(match.state),
      undefined,
      [{ income: 1 }, { growth: 1 }],
    );
    const rates = commands
      .filter((command) => command.cmd.t === 'setTax')
      .map((command) => [command.playerId, command.cmd.t === 'setTax' ? command.cmd.rate : null]);

    expect(rates).toEqual([[0, fp(0.4)]]);
  });

  it('изменение веса меняет ставку налога и решение наступления', () => {
    const match = scenario('A1 a B1 b', { legend, fog: false });
    const first = botCommands(match.state, [0], createBotTickContext(match.state), undefined, [
      { income: 1 },
    ]);
    const second = botCommands(match.state, [0], createBotTickContext(match.state), undefined, [
      { growth: 1 },
    ]);

    expect(first).not.toEqual(second);
    expect(first.some(({ cmd }) => cmd.t === 'setTax')).toBe(true);
    expect(second.some(({ cmd }) => cmd.t === 'setTax')).toBe(true);
  });

  it('уровень easy не меняет правила команд при одинаковых весах', () => {
    const match = scenario('A1 a B1 b', { legend, fog: false });
    const context = createBotTickContext(match.state);
    const weights = { income: 1 };

    expect(brainDecide(match.state, 0, context, 'easy', weights)).toEqual(
      brainDecide(match.state, 0, context, 'medium', weights),
    );
  });

  it('явный вес меняет решение ▶', () => {
    const match = scenario('A1 a B1 b', { legend, fog: false });
    const command = { t: 'startOffensive', armyId: 1 } as const;
    const options: readonly CommandOptionEntry[] = [
      {
        kind: 'startOffensive',
        options: () => [{ command, group: 'army:1', effects: { frontRatio: fp(1) } }],
      },
    ];

    expect(
      planBotActions(match.state, 0, createBotTickContext(match.state), { frontRatio: 1 }, options),
    ).toEqual([{ t: 'setAutoReinforce', on: true }, command]);
    expect(
      planBotActions(
        match.state,
        0,
        createBotTickContext(match.state),
        { frontRatio: -1 },
        options,
      ),
    ).toEqual([{ t: 'setAutoReinforce', on: true }]);
  });
});
