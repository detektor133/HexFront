import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { contrast, renderCss, renderTs, type TokenValue } from './generate.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const tokens = JSON.parse(read('docs/art/tokens.json')) as {
  players: { palette: { id: string; line: string }[]; minContrastOnWhite: number };
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

  it('контраст считается по WCAG', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('сгенерированные tokens.ts и tokens.css совпадают с генерацией из tokens.json', () => {
    const source = tokens as unknown as TokenValue;
    expect(read('apps/client/src/theme/tokens.ts')).toBe(renderTs(source));
    expect(read('apps/client/src/theme/tokens.css')).toBe(renderCss(source));
  });

  it('комментарии $… не попадают в вывод', () => {
    const out = renderTs({ a: 1, $comment: 'x', b: { $schema: 'y', c: '#FFFFFF' } });
    expect(out).not.toContain('$');
    expect(renderCss({ radius: { card: 12 }, map: { water: '#CFE3F2' } })).toContain(
      '--radius-card: 12px;',
    );
  });
});
