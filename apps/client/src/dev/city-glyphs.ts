// Знаки города — три кандидата на выбор владельца (DECISIONS 2026-09-25, style-guide «Города»).
// Размер знака — доля радиуса гекса, толщины — экранные px; цвета — из токенов.
import type { Container, Graphics } from 'pixi.js';
import { Text } from 'pixi.js';

import type { Point } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

export type CityStyle = 'circle' | 'houses' | 'shield';
export const CITY_STYLES: readonly CityStyle[] = ['circle', 'houses', 'shield'];

export interface CityGlyph {
  readonly at: Point;
  readonly level: number;
  readonly color: string;
  readonly isCapital: boolean;
  readonly isolated: boolean;
}

// Пропорции знаков в долях радиуса по уровню: геометрия, а не цвет или толщина.
const STAR_OUTER = 0.62;
const STAR_INNER = 0.27;
const HOUSE_SIZE = 0.55;
const HOUSE_GAP = 1.3;
const SHIELD_PAD_PX = 3;
const FONT_SCALE = 1.1;
const OUTLINE_PX = 1.5;
const BREAK_PX = 4;

/** Размер знака — доля радиуса гекса: растёт с уровнем и масштабируется вместе с картой. */
const SIZE_BASE = 0.36;
const SIZE_PER_LEVEL = 0.08;
const glyphSize = (hexRadius: number, level: number): number =>
  hexRadius * (SIZE_BASE + SIZE_PER_LEVEL * (level - 1));

function star(g: Graphics, c: Point, outer: number, inner: number): void {
  const pts: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
  }
  g.poly(pts).fill(tokens.city.fill);
}

function drawCircle(g: Graphics, c: CityGlyph, size: number, k: number): void {
  const r = size;
  g.circle(c.at.x, c.at.y, r)
    .fill(c.color)
    .stroke({ color: tokens.city.fill, width: OUTLINE_PX * k });
  if (c.isCapital) star(g, c.at, r * STAR_OUTER, r * STAR_INNER);
}

function drawHouses(g: Graphics, c: CityGlyph, size: number, k: number): void {
  const s = size * HOUSE_SIZE;
  const step = s * 2 * HOUSE_GAP;
  const x0 = c.at.x - ((c.level - 1) * step) / 2;
  for (let i = 0; i < c.level; i += 1) {
    const x = x0 + i * step;
    g.poly([x - s, c.at.y + s, x - s, c.at.y, x, c.at.y - s, x + s, c.at.y, x + s, c.at.y + s]);
  }
  g.fill(c.color).stroke({ color: tokens.city.fill, width: OUTLINE_PX * k });
  if (!c.isCapital) return;
  const top = c.at.y - s * 3;
  g.moveTo(c.at.x, c.at.y - s)
    .lineTo(c.at.x, top)
    .stroke({ color: c.color, width: OUTLINE_PX * k });
  g.poly([c.at.x, top, c.at.x + s * 1.6, top + s * 0.6, c.at.x, top + s * 1.2]).fill(c.color);
}

function drawShield(g: Graphics, labels: Container, c: CityGlyph, size: number, k: number): void {
  const r = size + SHIELD_PAD_PX * k;
  const pts: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i;
    pts.push(c.at.x + r * Math.cos(a), c.at.y + r * Math.sin(a));
  }
  g.poly(pts)
    .fill(c.color)
    .stroke({ color: tokens.city.fill, width: OUTLINE_PX * k });
  const label = new Text({
    text: String(c.level),
    style: {
      fontFamily: tokens.font.ui.family,
      fontWeight: '500',
      fontSize: size * FONT_SCALE * 2,
      fill: tokens.city.fill,
    },
  });
  label.anchor.set(0.5);
  label.position.set(c.at.x, c.at.y);
  label.scale.set(0.5);
  labels.addChild(label);
  if (!c.isCapital) return;
  const y = c.at.y - r - 2 * k;
  const w = r * 0.9;
  g.poly([
    c.at.x - w,
    y,
    c.at.x - w,
    y - r * 0.5,
    c.at.x - w / 2,
    y - r * 0.2,
    c.at.x,
    y - r * 0.6,
    c.at.x + w / 2,
    y - r * 0.2,
    c.at.x + w,
    y - r * 0.5,
    c.at.x + w,
    y,
  ]).fill(c.color);
}

// Пометка разрыва у изолированного города: два коротких штриха status.danger справа сверху.
function drawBreak(g: Graphics, c: CityGlyph, size: number, k: number): void {
  const r = size;
  const b = BREAK_PX * k;
  for (const dx of [0, b]) {
    const x = c.at.x + r + dx;
    g.moveTo(x, c.at.y - r - b).lineTo(x + b, c.at.y - r);
  }
  g.stroke({ color: tokens.status.danger, width: OUTLINE_PX * k * 1.5, cap: 'round' });
}

/**
 * Рисует знаки городов: размер — доля радиуса гекса, толщины — экранные px (k = 1 / масштаб).
 * Текстовые подписи (цифра уровня) кладутся в labels, контейнер пересоздаётся на каждый кадр.
 */
export function drawCities(
  g: Graphics,
  labels: Container,
  cities: readonly CityGlyph[],
  style: CityStyle,
  k: number,
  hexRadius: number,
): void {
  for (const c of cities) {
    const size = glyphSize(hexRadius, c.level);
    if (style === 'circle') drawCircle(g, c, size, k);
    else if (style === 'houses') drawHouses(g, c, size, k);
    else drawShield(g, labels, c, size, k);
    if (c.isolated) drawBreak(g, c, size, k);
  }
}
