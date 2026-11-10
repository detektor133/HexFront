import { describe, expect, it } from 'vitest';

import type { ArmyView } from '@hexfront/sim';

import { clampLimit, hireEstimate, limitCommand } from '../src/dev/army-limit.ts';

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

describe('оценка найма', () => {
  it('излишек техники не вычитается из недобора пехоты: нанимается не больше разницы до лимита', () => {
    const have = { infantry: 5000, armor: 5000, artillery: 0 };
    const want = { infantry: 13000, armor: 2000, artillery: 1000 };
    expect(hireEstimate(have, want).soldiers).toBe(6000);
  });

  it('золото считается по цене типа: пехота 0,1, танки 1', () => {
    const have = { infantry: 1000, armor: 0, artillery: 0 };
    expect(hireEstimate(have, { infantry: 2000, armor: 0, artillery: 0 })).toEqual({
      soldiers: 1000,
      gold: 100,
    });
    expect(hireEstimate(have, { infantry: 1000, armor: 500, artillery: 0 })).toEqual({
      soldiers: 500,
      gold: 500,
    });
  });
});
