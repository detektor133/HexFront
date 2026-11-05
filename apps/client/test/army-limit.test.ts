import { describe, expect, it } from 'vitest';

import type { ArmyView } from '@hexfront/sim';

import { clampLimit, limitCommand } from '../src/dev/army-limit.ts';

const army = (dir?: ArmyView['dir']): ArmyView => ({
  id: 7,
  number: 2,
  name: '',
  auto: false,
  wanted: 200,
  ...(dir ? { dir } : {}),
});

describe('лимит армии', () => {
  it('лимит любой армии, с направлением или без, меняет одна команда setArmyLimit', () => {
    const expected = { t: 'setArmyLimit', armyId: 7, soldiers: 150 };
    expect(limitCommand(army({ target: 3, mode: 'hold' }), 150)).toEqual(expected);
    expect(limitCommand(army({ target: -1, mode: 'attack' }), 150)).toEqual(expected);
    expect(limitCommand(army(), 150)).toEqual(expected);
  });

  it('значение зажато в 0..предел, ', () => {
    expect(clampLimit(-5, 300)).toBe(0);
    expect(clampLimit(999, 300)).toBe(300);
    expect(clampLimit(Number.NaN, 300)).toBe(0);
  });
});
