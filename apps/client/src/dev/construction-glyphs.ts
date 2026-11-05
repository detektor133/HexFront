import type { Graphics } from 'pixi.js';

import { depotLevel, fortLevel, isDepot, isFort } from '@hexfront/sim';

import type { MapIcon } from './map-icons.ts';
import type { Point } from '../render/hex-geometry.ts';

export interface ConstructionGlyph {
  readonly at: Point;
  readonly color: string;
  readonly building: number;
  readonly improvement: number;
  /** На гексе стоит город: знаки делят гекс. */
  readonly city: boolean;
}

/**
 * Знаки построек (с точками уровня) для слоя map-icons.
 * @returns иконки укрепления, склада и благоустройства
 */
export function drawConstructions(
  _g: Graphics,
  glyphs: readonly ConstructionGlyph[],
  _scale: number,
  hexRadius: number,
): MapIcon[] {
  const icons: MapIcon[] = [];
  const R = hexRadius;
  for (const glyph of glyphs) {
    const kind = isFort(glyph.building) ? 'fort' : isDepot(glyph.building) ? 'depot' : null;
    const size = R * (glyph.city ? 0.62 : 0.8);
    // На гексе города здание — в верхнем правом углу, город сдвинут влево-вниз.
    const at = glyph.city
      ? { x: glyph.at.x + R * 0.42, y: glyph.at.y - R * 0.34 }
      : { x: glyph.at.x, y: glyph.at.y - R * 0.08 };
    if (kind) {
      icons.push({ kind, at, color: glyph.color, size });
      // Уровень — точки под знаком: на одну меньше уровня (первый уровень без точек).
      const level = kind === 'fort' ? fortLevel(glyph.building) : depotLevel(glyph.building);
      for (let i = 1; i < level; i += 1) {
        const x = at.x + (i - level / 2) * size * 0.3;
        icons.push({
          kind: 'dot',
          at: { x, y: at.y + size * 0.62 },
          color: glyph.color,
          size: size * 0.38,
        });
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
