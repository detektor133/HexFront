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
  /** Склад стоит у воды: это порт, знак — якорь. */
  readonly port?: boolean;
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
    // На гексе могут стоять и укрепление, и склад: два знака рядом.
    const kinds = [
      ...(isFort(glyph.building) ? (['fort'] as const) : []),
      ...(isDepot(glyph.building) ? ([glyph.port === true ? 'port' : 'depot'] as const) : []),
    ];
    const kind = kinds[0] ?? null;
    const size = R * (glyph.city ? 0.62 : kinds.length > 1 ? 0.6 : 0.8);
    // На гексе города здание — в верхнем правом углу, город сдвинут влево-вниз.
    const base = glyph.city
      ? { x: glyph.at.x + R * 0.42, y: glyph.at.y - R * 0.34 }
      : { x: glyph.at.x, y: glyph.at.y - R * 0.08 };
    kinds.forEach((one, index) => {
      const at =
        kinds.length > 1 ? { x: base.x + (index === 0 ? -0.55 : 0.55) * size, y: base.y } : base;
      icons.push({ kind: one, at, color: glyph.color, size });
      // Уровень — точки под знаком: на одну меньше уровня (первый уровень без точек).
      const level = one === 'fort' ? fortLevel(glyph.building) : depotLevel(glyph.building);
      for (let i = 1; i < level; i += 1) {
        const x = at.x + (i - level / 2) * size * 0.3;
        icons.push({
          kind: 'dot',
          at: { x, y: at.y + size * 0.62 },
          color: glyph.color,
          size: size * 0.38,
        });
      }
    });

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
