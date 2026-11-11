import { describe, expect, it } from 'vitest';

import { isProfane, sanitizeNick } from '../src/nick.ts';

describe('ник', () => {
  it('принимает обычные ники и обрезает пробелы', () => {
    expect(sanitizeNick('  Игрок 1 ')).toBe('Игрок 1');
    expect(sanitizeNick('Max_99')).toBe('Max_99');
  });

  it('отклоняет короткие, длинные и с управляющими символами', () => {
    expect(sanitizeNick('a')).toBeNull();
    expect(sanitizeNick('x'.repeat(21))).toBeNull();
    expect(sanitizeNick('<b>hi</b>')).toBeNull();
    expect(sanitizeNick('ab\u0000cd')).not.toContain('\u0000');
  });

  it('ловит мат на русском и английском, в том числе замаскированный', () => {
    expect(isProfane('ХУЙ')).toBe(true);
    expect(isProfane('xyй')).toBe(true);
    expect(isProfane('fuck_you')).toBe(true);
    expect(isProfane('Sh1t')).toBe(false);
    expect(isProfane('Максим')).toBe(false);
  });
});
