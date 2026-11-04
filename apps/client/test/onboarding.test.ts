import { describe, expect, it } from 'vitest';

import { nextStep, prevStep, TUTORIAL_STEPS } from '../src/match/onboarding.ts';

describe('обучение первого матча', () => {
  it('шаги идут по порядку и заканчиваются на последнем', () => {
    expect(nextStep(0)).toBe(1);
    expect(nextStep(TUTORIAL_STEPS.length - 1)).toBeNull();
  });

  it('назад с первого шага остаётся на первом', () => {
    expect(prevStep(0)).toBe(0);
    expect(prevStep(3)).toBe(2);
  });

  it('есть шаги про ПКМ по чужой и ничьей земле', () => {
    const right = TUTORIAL_STEPS.filter((s) => s.button === 'right').map((s) => s.id);
    expect(right).toEqual(expect.arrayContaining(['enemy', 'neutral', 'order']));
  });
});
