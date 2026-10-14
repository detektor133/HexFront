import { describe, expect, it } from 'vitest';

import { isDevPath, isMatchPath, QUICK_MATCH_SEEDS, quickMatchUrl } from '../src/routes.ts';

describe('маршруты главного меню', () => {
  it('ведёт кнопку «Играть» на матч с 30 участниками и процедурной картой', () => {
    const url = new URL(`http://localhost${quickMatchUrl()}`);

    expect(url.pathname).toBe('/match');
    expect(url.searchParams.get('map')).toBe('gen');
    expect(url.searchParams.get('players')).toBe('30');
    expect(QUICK_MATCH_SEEDS).toContain(Number(url.searchParams.get('seed')));
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
