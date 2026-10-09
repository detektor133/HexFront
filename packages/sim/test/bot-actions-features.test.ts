import { describe, expect, it } from 'vitest';

import { actionFeatures } from '../src/bots/features.ts';
import { fp, fpMul } from '../src/math/int.ts';

describe('признаки вариантов команд бота', () => {
  it.each([
    ['threat', fp(0.25), fp(0.5)],
    ['goldSeconds', fp(2), fp(0.5)],
    ['neutralBorderShare', fp(0.4), fp(0.5)],
  ] as const)('строит контекст %s и произведение эффекта', (name, value, _expected) => {
    const features = actionFeatures(
      { command: { t: 'setTax', rate: fp(0.2) }, group: 'tax', effects: { strength: fp(2) } },
      { threat: fp(0.25), goldSeconds: fp(2), neutralBorderShare: fp(0.4) },
    );

    expect(features[name]).toBe(value);
    expect(features[`strength*${name}`]).toBe(fpMul(fp(2), value));
  });

  it('добавляет любой эффект без изменения кода признаков', () => {
    const features = actionFeatures(
      { command: { t: 'setTax', rate: fp(0.2) }, group: 'tax', effects: { testEffect: fp(3) } },
      { threat: fp(0), goldSeconds: fp(0), neutralBorderShare: fp(0) },
    );

    expect(features.testEffect).toBe(fp(3));
    expect(features['testEffect*threat']).toBe(0);
  });
});
