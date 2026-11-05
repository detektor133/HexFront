import type { Graphics } from 'pixi.js';

import { BUILDING, depotLevel, isDepot } from '@hexfront/sim';

import { ICON_FIT, type MapIcon } from './map-icons.ts';
import type { Point } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

const { construction } = tokens;

export interface ConstructionGlyph {
  readonly at: Point;
  readonly color: string;
  readonly building: number;
  readonly improvement: number;
}

/** Диск под иконкой: цвет владельца, белая обводка. */
function disc(g: Graphics, at: Point, radius: number, color: string, scale: number): void {
  g.circle(at.x, at.y, radius)
    .fill(color)
    .stroke({ color: construction.fill, width: construction.outline * scale });
}

/**
 * Рисует диски укрепления, склада и благоустройства; сами иконки — в слое map-icons.
 * @returns иконки, которые нужно поставить поверх дисков
 */
export function drawConstructions(
  g: Graphics,
  glyphs: readonly ConstructionGlyph[],
  scale: number,
  hexRadius: number,
): MapIcon[] {
  const icons: MapIcon[] = [];
  for (const glyph of glyphs) {
    const buildingRadius = hexRadius * construction.size;
    const buildingAt = { x: glyph.at.x, y: glyph.at.y - hexRadius * 0.35 };
    const kind =
      glyph.building === BUILDING.fort ? 'fort' : isDepot(glyph.building) ? 'depot' : null;
    if (kind) {
      disc(g, buildingAt, buildingRadius, glyph.color, scale);
      icons.push({ kind, at: buildingAt, size: buildingRadius * ICON_FIT });
    }
    if (kind === 'depot') {
      // Уровень склада — точки под знаком: две у второго уровня, три у третьего.
      for (let i = 1; i < depotLevel(glyph.building); i += 1) {
        const x = buildingAt.x + (i - (depotLevel(glyph.building) - 1) / 2) * buildingRadius * 0.7;
        g.circle(x, buildingAt.y + buildingRadius * 1.25, buildingRadius * 0.16)
          .fill(construction.fill)
          .stroke({ color: glyph.color, width: construction.outline * scale });
      }
    }

    if (glyph.improvement <= 0) continue;
    const improvementAt =
      glyph.building === BUILDING.none
        ? glyph.at
        : { x: glyph.at.x + hexRadius * 0.5, y: glyph.at.y - hexRadius * 0.5 };
    const radius = hexRadius * construction.improvementSize;
    disc(g, improvementAt, radius, glyph.color, scale);
    icons.push({ kind: 'improvement', at: improvementAt, size: radius * ICON_FIT });
  }
  return icons;
}
