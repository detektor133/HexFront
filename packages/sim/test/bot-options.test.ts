import { describe, expect, it } from 'vitest';

import { COMMAND_OPTIONS, type BotOptionDefinitions } from '../src/bots/options/index.ts';
import { fp } from '../src/math/int.ts';
import type { MatchState } from '../src/state/types.ts';

const state = {} as MatchState;
const context = {
  borderHexes: [[1]],
  ownedHexes: [[1, 2]],
  unitsByHex: [[], []],
  unitsByPlayer: [[]],
  citiesByPlayer: [[{ id: 1, hex: 1 }]],
  armiesByPlayer: [[]],
  plansByPlayer: [[]],
  incomeBases: [],
} as never;

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
    const options = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    );

    expect(options.length).toBeGreaterThan(0);
    expect(
      options.some((option) => Object.values(option.effects).some((value) => value !== 0)),
    ).toBe(true);
  });
});
