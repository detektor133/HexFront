// Знак города — круг-метка (DECISIONS 2026-09-25, style-guide «Города»): закрашенный круг цвета
// владельца; размер — доля радиуса гекса по уровню (масштабируется с картой), у столицы — звезда.
import { Text, type Container, type Graphics } from 'pixi.js';

import type { Point } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

const { city } = tokens;

export interface CityGlyph {
  readonly at: Point;
  readonly level: number;
  readonly color: string;
  readonly isCapital: boolean;
  readonly isolated: boolean;
}

export interface CityLabel {
  readonly at: Point;
  readonly name: string;
  readonly level: number;
  readonly isCapital: boolean;
}

/** Видимость подписи города на стратегическом уровне детализации. */
export function cityLabelVisible(level: number, isCapital: boolean, detail: 1 | 2 | 3): boolean {
  return detail !== 1 || isCapital || level >= 2;
}

/** Длина штриха пометки разрыва у изолированного города — доля радиуса знака. */
const BREAK_SHARE = 0.45;

/**
 * Радиус знака в мировых единицах: доля радиуса гекса по уровню. От масштаба камеры не зависит,
 * поэтому при приближении знак растёт вместе с гексами.
 * @returns радиус круга, те же единицы, что hexRadius
 */
export function citySize(hexRadius: number, level: number): number {
  const share = city.sizeByLevel[level - 1] ?? city.sizeByLevel[city.sizeByLevel.length - 1] ?? 0;
  return hexRadius * share;
}

function star(g: Graphics, c: Point, outer: number, inner: number): void {
  const pts: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
  }
  g.poly(pts).fill(city.fill);
}

// Пометка разрыва у изолированного города: два коротких штриха status.danger справа сверху.
function drawBreak(g: Graphics, c: CityGlyph, r: number, k: number): void {
  const b = r * BREAK_SHARE;
  for (const dx of [0, b]) {
    const x = c.at.x + r + dx;
    g.moveTo(x, c.at.y - r - b).lineTo(x + b, c.at.y - r);
  }
  g.stroke({ color: tokens.status.danger, width: city.outline * 1.5 * k, cap: 'round' });
}

/** Рисует знаки городов; k = 1 / масштаб камеры — только для экранной толщины обводки. */
export function drawCities(
  g: Graphics,
  cities: readonly CityGlyph[],
  k: number,
  hexRadius: number,
): void {
  for (const c of cities) {
    const r = citySize(hexRadius, c.level);
    g.circle(c.at.x, c.at.y, r)
      .fill(c.color)
      .stroke({ color: city.fill, width: city.outline * k });
    if (c.isCapital) star(g, c.at, r * city.capitalStarOuter, r * city.capitalStarInner);
    if (c.isolated) drawBreak(g, c, r, k);
  }
}

/** Рисует подписи городов с жёстким ореолом цвета поверхности карты. */
export function drawCityLabels(
  container: Container,
  cities: readonly CityLabel[],
  scale: number,
  detail: 1 | 2 | 3,
  hexRadius: number,
): void {
  for (const city of cities) {
    if (city.name === '' || !cityLabelVisible(city.level, city.isCapital, detail)) continue;
    const fontSize =
      tokens.city.labelSize[detail - 1] ??
      tokens.city.labelSize[tokens.city.labelSize.length - 1] ??
      0;
    const text = new Text({
      text: city.name,
      style: {
        fontFamily: tokens.font.ui.family,
        fontWeight: '400',
        fontSize,
        fill: tokens.ui.ink,
        stroke: { color: tokens.ui.surface, width: tokens.city.labelHalo },
      },
    });
    text.resolution = window.devicePixelRatio * 2;
    text.anchor.set(0.5, 0);
    text.scale.set(1 / scale);
    text.position.set(city.at.x, city.at.y + hexRadius * 0.68);
    container.addChild(text);
  }
}
