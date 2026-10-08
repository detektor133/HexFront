import { describe, expect, it } from 'vitest';

import { availableOnboardingHints, type OnboardingState } from '../src/match/onboarding.ts';

const state: OnboardingState = {
  hasAutoArmy: true,
  canChangeTax: true,
  canFoundCity: true,
  canAssignFront: true,
  canStartOffensive: true,
};

describe('подсказки первого матча', () => {
  it('возвращает только подсказки для доступных ситуаций в заданном порядке', () => {
    expect(availableOnboardingHints({ ...state, canFoundCity: false }, new Set(['tax']))).toEqual([
      'autoCommand',
      'front',
      'offensive',
    ]);
  });

  it('не возвращает отключённые подсказки', () => {
    expect(
      availableOnboardingHints(
        state,
        new Set(['autoCommand', 'tax', 'foundCity', 'front', 'offensive']),
      ),
    ).toEqual([]);
  });
});
