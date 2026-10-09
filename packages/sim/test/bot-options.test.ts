import { describe, expect, it } from 'vitest';

import small from '../../mapgen/maps/small.json' with { type: 'json' };
import { createBotTickContext } from '../src/bots/context.ts';
import { COMMAND_OPTIONS, type BotOptionDefinitions } from '../src/bots/options/index.ts';
import { createMatch, loadMap } from '../src/index.ts';
import { fp } from '../src/math/int.ts';
import type { MatchState } from '../src/state/types.ts';

function fixture(): { state: MatchState; context: ReturnType<typeof createBotTickContext> } {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const state = createMatch(loaded.map, [{ name: 'A' }, { name: 'B' }], 42);
  const player = state.players[0];
  if (!player) throw new Error('игрок не создан');
  player.gold = fp(1000);
  return { state, context: createBotTickContext(state) };
}

const definitions: BotOptionDefinitions = {
  units: {
    scouts: {
      costGoldPerSoldier: fp(0.2),
      upkeepGoldPerSoldierS: fp(0.004),
      upkeepGoldPerUnitS: fp(0.05),
      attack: fp(3),
      defense: fp(2),
      supplyPerSoldier: fp(0.5),
    },
  },
  buildings: {
    watchtower: {
      costGold: fp(90),
      defenseMult: fp(1.1),
      supplyLossMult: fp(0.9),
      supplyRadius: 2,
    },
  },
};

describe('варианты команд бота', () => {
  it('регистрирует все виды команд отдельными генераторами', () => {
    expect(COMMAND_OPTIONS.map((entry) => entry.kind)).toEqual([
      'recruit',
      'build',
      'upgradeCity',
      'improve',
      'foundCity',
      'rebuildSupply',
      'setTax',
      'startOffensive',
      'stopOffensive',
    ]);
  });

  it('подхватывает фиктивные тип войск и постройку из definitions', () => {
    const { state, context } = fixture();
    const options = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    );

    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: expect.objectContaining({ type: 'scouts' }) }),
        expect.objectContaining({ command: expect.objectContaining({ kind: 'watchtower' }) }),
      ]),
    );
  });

  it('возвращает эффекты fixed-point, а не пустой каталог', () => {
    const { state, context } = fixture();
    const options = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    );

    expect(options.length).toBeGreaterThan(0);
    expect(
      options.some((option) => Object.values(option.effects).some((value) => value !== 0)),
    ).toBe(true);
  });

  it('нормализует цену относительно текущей казны игрока', () => {
    const { state, context } = fixture();
    const recruit = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    ).find((candidate) => candidate.command.t === 'recruit');

    expect(recruit?.effects.cost).toBe(fp(0.01));
  });

  it('отбрасывает варианты для неполного состояния', () => {
    const state = {} as MatchState;
    const context = {} as never;
    const options = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    );

    expect(options).toEqual([]);
  });
});
