import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Formatter from '../src/i18n/format.ts';

type FormatterModule = typeof Formatter;

async function loadFormatter(language: string): Promise<FormatterModule> {
  vi.resetModules();
  vi.stubGlobal('navigator', { language });
  return import('../src/i18n/format.ts');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('07/T17awb: компактный локализованный формат HUD', () => {
  it('границы 999/1 000/9 999/10 000/999 999/1 000 000 дают единый формат ru/en', async () => {
    for (const language of ['ru-RU', 'en-US']) {
      const { formatCompact } = await loadFormatter(language);
      const suffix = language === 'ru-RU' ? ['к', 'м'] : ['k', 'm'];
      const decimal = language === 'ru-RU' ? ',' : '.';

      expect(formatCompact(999_000)).toBe('999');
      expect(formatCompact(999_500)).toBe('1 000');
      expect(formatCompact(1_000_000)).toBe(`1${decimal}0${suffix[0]}`);
      expect(formatCompact(9_999_000)).toBe(`9${decimal}9${suffix[0]}`);
      expect(formatCompact(10_000_000)).toBe(`10${suffix[0]}`);
      expect(formatCompact(999_999_000)).toBe(`999${suffix[0]}`);
      expect(formatCompact(1_000_000_000)).toBe(`1${decimal}0${suffix[1]}`);
      expect(formatCompact(987_654_000)).toBe(language === 'ru-RU' ? '987к' : '987k');
    }
  });

  it('знак и /с сохраняются для малого, тысячного и отрицательного прироста ru/en', async () => {
    for (const language of ['ru-RU', 'en-US']) {
      const { formatRate } = await loadFormatter(language);
      const decimal = language === 'ru-RU' ? ',' : '.';
      const perSecond = language === 'ru-RU' ? '/с' : '/s';

      expect(formatRate(47_000)).toBe(`+47${perSecond}`);
      expect(formatRate(1_200_000)).toBe(
        `+1${decimal}2${language === 'ru-RU' ? 'к' : 'k'}${perSecond}`,
      );
      expect(formatRate(-2_100_000)).toBe(
        `−2${decimal}1${language === 'ru-RU' ? 'к' : 'k'}${perSecond}`,
      );
    }
  });
});
