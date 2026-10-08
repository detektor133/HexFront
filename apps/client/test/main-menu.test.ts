import { describe, expect, it } from 'vitest';

import { isDevPath, isMatchPath, quickMatchUrl } from '../src/routes.ts';

describe('маршруты главного меню', () => {
  it('ведёт кнопку «Играть» на матч с 30 участниками и процедурной картой', () => {
    expect(quickMatchUrl()).toBe('/match?map=gen&seed=42&players=30');
  });

  it('сохраняет dev-маршруты отдельно от обычного меню', () => {
    expect(isDevPath('/dev/sandbox')).toBe(true);
    expect(isDevPath('/')).toBe(false);
    expect(isDevPath('/match')).toBe(false);
  });

  it('выделяет обычный экран матча отдельным маршрутом', () => {
    expect(isMatchPath('/match')).toBe(true);
    expect(isMatchPath('/dev/sandbox')).toBe(false);
  });
});
