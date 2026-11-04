import { describe, expect, it } from 'vitest';

import { availableOnboardingHints, type OnboardingState } from '../src/match/onboarding.ts';

const state: OnboardingState = {
  canExpand: true,
  canChangeTax: true,
  canFoundCity: true,
  canAttack: true,
  canHold: true,
  canBuildDepot: true,
};

describe('подсказки первого матча', () => {
  it('возвращает только подсказки для доступных ситуаций в заданном порядке', () => {
    expect(
      availableOnboardingHints({ ...state, canFoundCity: false }, new Set(['expand', 'tax'])),
    ).toEqual(['attack', 'hold', 'depot']);
  });

  it('не возвращает отключённые подсказки', () => {
    expect(
      availableOnboardingHints(
        state,
        new Set(['expand', 'tax', 'foundCity', 'attack', 'hold', 'depot']),
      ),
    ).toEqual([]);
  });
});
