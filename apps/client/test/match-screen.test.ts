import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MatchPage } from '../src/match/MatchPage.tsx';

const MATCH_PAGE_SOURCE = readFileSync(
  new URL('../src/match/MatchPage.tsx', import.meta.url),
  'utf8',
);
const MATCH_SURFACE_SOURCE = readFileSync(
  new URL('../src/dev/DevSandboxPage.tsx', import.meta.url),
  'utf8',
);
const MAIN_SOURCE = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

describe('экран матча игрока', () => {
  it('на /match без debug отключает панель наблюдателя, туманный переключатель и отказ команды', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search: '' } },
    });

    const markup = renderToStaticMarkup(createElement(MatchPage));

    expect(markup).not.toMatch(/Пауза|Шаг|1×|5×|20×|Вся карта|Игрок 1|Скачать телеметрию/gu);
    expect(markup).not.toContain('Последний отказ');
    expect(MATCH_PAGE_SOURCE).toMatch(/<MatchSurface debug=\{debug\} showOnboarding \/>/u);
  });

  it('на /match?debug=1 включает панель наблюдателя и отладочные элементы', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search: '?debug=1' } },
    });

    const markup = renderToStaticMarkup(createElement(MatchPage));

    expect(markup).toContain('class="_page_');
    expect(MATCH_PAGE_SOURCE).toMatch(/<MatchSurface debug=\{debug\} showOnboarding \/>/u);
    expect(MATCH_SURFACE_SOURCE).toMatch(/\{debug && view && \(/u);
  });

  it('оставляет /dev/sandbox недоступным в production-сборке', () => {
    expect(MAIN_SOURCE).toMatch(
      /if\s*\(import\.meta\.env\.PROD\s*&&\s*isDevPath\(path\)\)\s*return\s*<p>\{t\('dev\.notFound'\)\}<\/p>/su,
    );
  });
});
