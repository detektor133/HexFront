import type { Graphics } from 'pixi.js';

import { BUILDING, depotLevel, isDepot } from '@hexfront/sim';

import type { MapIcon } from './map-icons.ts';
import type { Point } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

const { construction } = tokens;

export interface ConstructionGlyph {
  readonly at: Point;
  readonly color: string;
  readonly building: number;
  readonly improvement: number;
  /** На гексе стоит город: знаки делят гекс. */
  readonly city: boolean;
}

/**
 * Рисует точки уровня склада; сами знаки — иконки слоя map-icons.
 * @returns иконки укрепления, склада и благоустройства
 */
export function drawConstructions(
  g: Graphics,
  glyphs: readonly ConstructionGlyph[],
  scale: number,
  hexRadius: number,
): MapIcon[] {
  const icons: MapIcon[] = [];
  const R = hexRadius;
  for (const glyph of glyphs) {
    const kind =
      glyph.building === BUILDING.fort ? 'fort' : isDepot(glyph.building) ? 'depot' : null;
    const size = R * (glyph.city ? 0.62 : 0.8);
    // На гексе города здание — в верхнем правом углу, город сдвинут влево-вниз.
    const at = glyph.city
      ? { x: glyph.at.x + R * 0.42, y: glyph.at.y - R * 0.34 }
      : { x: glyph.at.x, y: glyph.at.y - R * 0.08 };
    if (kind) {
      icons.push({ kind, at, color: glyph.color, size });
    }
    if (kind === 'depot') {
      // Уровень склада — точки под знаком: две у второго уровня, три у третьего.
      const level = depotLevel(glyph.building);
      for (let i = 1; i < level; i += 1) {
        const x = at.x + (i - (level - 1) / 2) * size * 0.3;
        g.circle(x, at.y + size * 0.62, size * 0.09)
          .fill(glyph.color)
          .stroke({ color: construction.fill, width: construction.outline * scale });
      }
    }

    if (glyph.improvement <= 0) continue;
    const shared = kind !== null || glyph.city;
    icons.push({
      kind: 'improvement',
      at: shared ? { x: glyph.at.x + R * 0.5, y: glyph.at.y + R * 0.45 } : glyph.at,
      color: glyph.color,
      size: R * (shared ? 0.42 : 0.55),
    });
  }
  return icons;
}
