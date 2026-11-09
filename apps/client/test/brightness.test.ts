import { describe, expect, it } from 'vitest';

import {
  BRIGHTNESS_DEFAULT,
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  brightnessStyle,
  clampBrightness,
} from '../src/settings/brightness.ts';

describe('яркость карты', () => {
  it('значение зажимается в пределы ползунка, мусор даёт 100 %', () => {
    expect(clampBrightness(10)).toBe(BRIGHTNESS_MIN);
    expect(clampBrightness(500)).toBe(BRIGHTNESS_MAX);
    expect(clampBrightness(Number.NaN)).toBe(BRIGHTNESS_DEFAULT);
    expect(clampBrightness(87.4)).toBe(87);
  });

  it('при 100 % фильтра нет, иначе brightness в долях', () => {
    expect(brightnessStyle(100)).toBeUndefined();
    expect(brightnessStyle(80)).toEqual({ filter: 'brightness(0.8)' });
  });
});
