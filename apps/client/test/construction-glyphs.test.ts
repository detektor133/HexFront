import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { BUILDING } from '@hexfront/sim';

import { drawConstructions, type ConstructionGlyph } from '../src/dev/construction-glyphs.ts';
import { tokens } from '../src/theme/tokens.ts';

const R = tokens.map.hexRadius;
const at = { x: 100, y: 100 };
const glyph = (over: Partial<ConstructionGlyph>): ConstructionGlyph => ({
  at,
  color: '#0E7C6B',
  building: BUILDING.none,
  improvement: 0,
  city: false,
  ...over,
});

describe('знаки построек', () => {
  it('укрепление, склад и благоустройство — иконки цвета владельца без дисков', () => {
    const icons = drawConstructions(
      new Graphics(),
      [
        glyph({ building: BUILDING.fort, improvement: 1 }),
        glyph({ at: { x: 300, y: 100 }, building: BUILDING.depot }),
      ],
      1,
      R,
    );
    expect(icons.map((i) => i.kind)).toEqual(['fort', 'improvement', 'depot']);
    expect(icons.every((i) => i.color === '#0E7C6B')).toBe(true);
  });

  it('пустой гекс ничего не рисует', () => {
    expect(drawConstructions(new Graphics(), [glyph({})], 1, R)).toEqual([]);
  });

  it('на гексе города здание уходит в угол и мельчает, чтобы не перекрывать город', () => {
    const [alone] = drawConstructions(new Graphics(), [glyph({ building: BUILDING.fort })], 1, R);
    const [shared] = drawConstructions(
      new Graphics(),
      [glyph({ building: BUILDING.fort, city: true })],
      1,
      R,
    );
    if (!alone || !shared) throw new Error('иконки не созданы');
    expect(shared.size).toBeLessThan(alone.size);
    expect(shared.at.x).toBeGreaterThan(at.x);
    expect(shared.at.y).toBeLessThan(at.y);
  });

  it('благоустройство одно на гексе крупнее, чем рядом со зданием', () => {
    const [alone] = drawConstructions(new Graphics(), [glyph({ improvement: 2 })], 1, R);
    const withFort = drawConstructions(
      new Graphics(),
      [glyph({ building: BUILDING.fort, improvement: 2 })],
      1,
      R,
    );
    const corner = withFort.find((i) => i.kind === 'improvement');
    if (!alone || !corner) throw new Error('иконки не созданы');
    expect(corner.size).toBeLessThan(alone.size);
  });
});
