import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  contrast,
  renderCss,
  renderThemesCss,
  renderThemesTs,
  renderTs,
  type TokenValue,
} from './generate.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const tokens = JSON.parse(read('docs/art/tokens.json')) as {
  players: { palette: { id: string; line: string }[]; minContrastOnWhite: number };
  relation: { own: string; ally: string; enemy: string };
  armies: { palette: string[] };
};

describe('токены', () => {
  it('контраст каждого цвета игрока к белому не ниже minContrastOnWhite', () => {
    const { palette, minContrastOnWhite } = tokens.players;
    expect(minContrastOnWhite).toBe(4.5);
    const weak = palette
      .map((p) => ({ id: p.id, ratio: contrast(p.line, '#FFFFFF') }))
      .filter((p) => p.ratio < minContrastOnWhite);
    expect(weak).toEqual([]);
  });

  it('цвета отношений и армий читаются на белом (контраст ≥ 4,5)', () => {
    const { own, ally, enemy } = tokens.relation;
    const colors = [own, ally, enemy, ...tokens.armies.palette];
    const weak = colors.filter((c) => contrast(c, '#FFFFFF') < tokens.players.minContrastOnWhite);
    expect(weak).toEqual([]);
  });

  it('контраст считается по WCAG', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('сгенерированные tokens.ts и tokens.css совпадают с генерацией из tokens.json', () => {
    const source = tokens as unknown as TokenValue;
    expect(read('apps/client/src/theme/tokens.ts')).toBe(renderTs(source));
    expect(read('apps/client/src/theme/tokens.css')).toBe(renderCss(source));
  });

  it('темы интерфейса: сгенерированные themes.css и themes.ts совпадают с themes.json', () => {
    const themes = JSON.parse(read('docs/art/themes.json')) as Parameters<
      typeof renderThemesCss
    >[0];
    expect(read('apps/client/src/theme/themes.css')).toBe(renderThemesCss(themes));
    expect(read('apps/client/src/theme/themes.ts')).toBe(renderThemesTs(themes));
    expect(themes.themes.map((t) => t.id)).toEqual(['mint', 'hoi', 'civ', 'kingdom']);
  });

  it('каждая тема задаёт полный набор переменных интерфейса', () => {
    const css = renderThemesCss(
      JSON.parse(read('docs/art/themes.json')) as Parameters<typeof renderThemesCss>[0],
    );
    for (const block of css.split('[data-theme=').slice(1)) {
      for (const name of ['--ui-ink', '--ui-surface', '--ui-button-primary-bg', '--shadow-hard']) {
        expect(block).toContain(name);
      }
    }
  });

  it('комментарии $… не попадают в вывод', () => {
    const out = renderTs({ a: 1, $comment: 'x', b: { $schema: 'y', c: '#FFFFFF' } });
    expect(out).not.toContain('$');
    expect(renderCss({ radius: { card: 12 }, map: { water: '#CFE3F2' } })).toContain(
      '--radius-card: 12px;',
    );
  });
});
