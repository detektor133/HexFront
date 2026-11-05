// Знак города — круг-метка (DECISIONS 2026-09-25, style-guide «Города»): закрашенный круг цвета
// владельца; размер — доля радиуса гекса по уровню (масштабируется с картой), у столицы — звезда.
import { Text, type Container, type Graphics } from 'pixi.js';

import { ICON_FIT, type MapIcon } from './map-icons.ts';
import type { Point } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

const { city } = tokens;

export interface CityGlyph {
  readonly at: Point;
  readonly level: number;
  readonly color: string;
  readonly isCapital: boolean;
  readonly isolated: boolean;
  /** На гексе города есть здание: знак сдвигается, чтобы не перекрывать его. */
  readonly shared: boolean;
}

export interface CityLabel {
  readonly at: Point;
  readonly name: string;
  readonly level: number;
  readonly isCapital: boolean;
}

/** Ключ полей, при изменении которых подпись города нужно пересоздать. */
export function cityLabelsKey(
  cities: readonly Pick<CityLabel, 'name' | 'level' | 'isCapital'>[],
  scale: number,
  detail: 1 | 2 | 3,
): string {
  return `${scale}|${detail}|${cities.map((c) => `${c.name}:${c.level}:${c.isCapital}`).join(',')}`;
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

// Пометка разрыва у изолированного города: два коротких штриха status.danger справа сверху.
function drawBreak(g: Graphics, c: CityGlyph, r: number, k: number): void {
  const b = r * BREAK_SHARE;
  for (const dx of [0, b]) {
    const x = c.at.x + r + dx;
    g.moveTo(x, c.at.y - r - b).lineTo(x + b, c.at.y - r);
  }
  g.stroke({ color: tokens.status.danger, width: city.outline * 1.5 * k, cap: 'round' });
}

/**
 * Рисует пометки разрыва у изолированных городов; k = 1 / масштаб камеры — для экранной толщины.
 * @returns иконки городов (замок, у столицы — звезда) цвета владельца
 */
export function drawCities(
  g: Graphics,
  cities: readonly CityGlyph[],
  k: number,
  hexRadius: number,
): MapIcon[] {
  const icons: MapIcon[] = [];
  for (const c of cities) {
    const r = citySize(hexRadius, c.level);
    // Рядом со зданием на том же гексе город сдвинут влево-вниз и чуть меньше.
    const scale = c.shared ? 0.85 : 1;
    const at = c.shared ? { x: c.at.x - hexRadius * 0.2, y: c.at.y + hexRadius * 0.12 } : c.at;
    icons.push({
      kind: c.isCapital ? 'capital' : 'city',
      at,
      color: c.color,
      size: r * ICON_FIT * scale,
    });
    if (c.isolated) drawBreak(g, { ...c, at }, r * scale, k);
  }
  return icons;
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
    text.resolution = (globalThis.window?.devicePixelRatio ?? 1) * 2;
    text.anchor.set(0.5, 0);
    text.scale.set(1 / scale);
    text.position.set(city.at.x, city.at.y + hexRadius * 0.68);
    container.addChild(text);
  }
}
