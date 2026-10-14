import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MatchPage } from '../src/match/MatchPage.tsx';

const MATCH_PAGE_SOURCE = readFileSync(
  new URL('../src/match/MatchPage.tsx', import.meta.url),
  'utf8',
);
const MAIN_SOURCE = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

describe('экран матча игрока', () => {
  it('на /match без debug отключает панель наблюдателя, туманный переключатель и отказ команды', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search: '' } },
    });

    const page = MatchPage();

    expect(page.props).toMatchObject({ debug: false, showOnboarding: true });
    expect(MATCH_PAGE_SOURCE).not.toMatch(/ObserverPanel|showFog|lastReject/gu);
  });

  it('на /match?debug=1 включает панель наблюдателя и отладочные элементы', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search: '?debug=1' } },
    });

    const page = MatchPage();

    expect(page.props).toMatchObject({ debug: true, showOnboarding: true });
    expect(MATCH_PAGE_SOURCE).not.toMatch(/DevSandboxPage/gu);
    expect(MATCH_PAGE_SOURCE).toMatch(/MatchSurface/gu);
  });

  it('оставляет /dev/sandbox недоступным в production-сборке', () => {
    expect(MAIN_SOURCE).toMatch(
      /if\s*\(import\.meta\.env\.PROD\s*&&\s*isDevPath\(path\)\)\s*return\s*<p>\{t\('dev\.notFound'\)\}<\/p>/su,
    );
  });
});
