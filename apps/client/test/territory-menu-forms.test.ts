// Формы меню земли: каждая рисуется без ошибок и даёт игроку действия «Держать» и «Наступать»
// (для чужой земли) или «Занять» (для ничьей), чтобы казуал мог одним кликом воевать.
import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { TerritoryMenu } from '../src/dev/TerritoryMenu.tsx';
import { createLocalEngine } from '../src/local/engine.ts';
import { MENU_STYLES, writeMenuStyle } from '../src/settings/menu-style.ts';

const tiny: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(tiny);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const engine = createLocalEngine(tiny, 42, 2, [1], false, '', true);
if ('errors' in engine) throw new Error(engine.errors.join('; '));
const view = engine.snapshot().view;

function render(other: number): string {
  return renderToStaticMarkup(
    createElement(TerritoryMenu, {
      view,
      map: loaded.ok ? loaded.map : (undefined as never),
      other,
      hex: 0,
      at: { x: 300, y: 300 },
      send: () => undefined,
      onClose: () => undefined,
    }),
  );
}

describe('формы меню земли', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720 });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  });

  it.each(MENU_STYLES)(
    'форма «%s»: чужая земля — держать и наступать, есть переключатель',
    (style) => {
      writeMenuStyle(style);
      const html = render(1);
      expect(html).toContain('data-tutorial="hold"');
      expect(html).toContain('data-tutorial="attack"');
      expect(html).toMatch(/\d\/5/);
    },
  );

  it.each(MENU_STYLES)('форма «%s»: ничья земля — занять', (style) => {
    writeMenuStyle(style);
    const html = render(-1);
    expect(html).toContain('data-tutorial="occupy"');
  });
});
