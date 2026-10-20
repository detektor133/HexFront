import type { Graphics } from 'pixi.js';

import { BUILDING } from '@hexfront/sim';

import type { Point } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

const { construction } = tokens;

export interface ConstructionGlyph {
  readonly at: Point;
  readonly color: string;
  readonly building: number;
  readonly improvement: number;
}

function polygonCenter(at: Point, radius: number, angle: number): number[] {
  return [at.x + Math.cos(angle) * radius, at.y + Math.sin(angle) * radius];
}

function drawFort(g: Graphics, at: Point, radius: number, color: string, scale: number): void {
  g.poly([
    ...polygonCenter(at, radius, -Math.PI / 2),
    ...polygonCenter(at, radius, 0),
    ...polygonCenter(at, radius, Math.PI / 2),
    ...polygonCenter(at, radius, Math.PI),
  ])
    .fill(color)
    .stroke({ color: construction.fill, width: construction.outline * scale });
}

function drawDepot(g: Graphics, at: Point, radius: number, color: string, scale: number): void {
  g.poly([
    ...polygonCenter(at, radius, -Math.PI / 2),
    ...polygonCenter(at, radius, Math.PI / 6),
    ...polygonCenter(at, radius, (5 * Math.PI) / 6),
  ])
    .fill(color)
    .stroke({ color: construction.fill, width: construction.outline * scale });
}

/** Рисует процедурные знаки укрепления, склада и благоустройства. */
export function drawConstructions(
  g: Graphics,
  glyphs: readonly ConstructionGlyph[],
  scale: number,
  hexRadius: number,
): void {
  for (const glyph of glyphs) {
    const buildingRadius = hexRadius * construction.size;
    const buildingAt = { x: glyph.at.x, y: glyph.at.y - hexRadius * 0.35 };
    if (glyph.building === BUILDING.fort) {
      drawFort(g, buildingAt, buildingRadius, glyph.color, scale);
    } else if (glyph.building === BUILDING.depot) {
      drawDepot(g, buildingAt, buildingRadius, glyph.color, scale);
    }

    if (glyph.improvement <= 0) continue;
    const improvementAt =
      glyph.building === BUILDING.none
        ? glyph.at
        : { x: glyph.at.x + hexRadius * 0.5, y: glyph.at.y - hexRadius * 0.5 };
    g.circle(improvementAt.x, improvementAt.y, hexRadius * construction.improvementSize)
      .fill(glyph.color)
      .stroke({ color: construction.fill, width: construction.outline * scale });
  }
}
