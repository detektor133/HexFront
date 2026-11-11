import { describe, expect, it } from 'vitest';

import { nickProblem, NICK_MIN } from '../src/menu/menu-config.ts';

describe('ник в меню', () => {
  it('пустой ник допустим (подставится имя по умолчанию)', () => {
    expect(nickProblem('')).toBe(false);
  });

  it('один символ не принимается, два и больше — да', () => {
    expect(nickProblem('a')).toBe(true);
    expect(nickProblem('a'.repeat(NICK_MIN))).toBe(false);
    expect(nickProblem('Danil')).toBe(false);
  });
});
