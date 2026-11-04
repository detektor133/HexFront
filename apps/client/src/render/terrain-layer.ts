// Слои карты 1–3 (вода, рельеф с узорами, реки) и сетка гексов.
// Правила: docs/art/style-guide.md, «Слои карты»; цвета и толщины — tokens.json.
// Заливки, сетка, берег и узоры рисует шейдер (terrain-gpu.ts); реки — несколько сглаженных
// кривых Graphics, которые перерисовываются только под новую толщину после зума.
import { Container, Graphics } from 'pixi.js';

import { hexFromId, type MapStatic } from '@hexfront/sim';

import type { DetailLevel } from './camera.ts';
import { hexCenter, hexEdge } from './hex-geometry.ts';
import { chainSegments } from './river-paths.ts';
import { createTerrainGpu } from './terrain-gpu.ts';
import { createTerrainRedrawGate } from './terrain-redraw.ts';
import { tokens } from '../theme/tokens.ts';

const { map: M } = tokens;

/** Детерминированное «случайное» число 0..1 от координат гекса и номера признака. */
export function hexNoise(q: number, r: number, salt: number): number {
  let h = Math.imul(q, 0x27d4eb2d) ^ Math.imul(r, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

// Ломаная по рёбрам сглаживается кривыми через середины звеньев; концы остаются на месте.
function drawSmooth(g: Graphics, points: readonly { x: number; y: number }[]): void {
  const [first, ...rest] = points;
  const last = rest.at(-1);
  if (!first || !last) return;
  g.moveTo(first.x, first.y);
  for (let i = 0; i < rest.length - 1; i += 1) {
    const p = rest[i];
    const next = rest[i + 1];
    if (!p || !next) continue;
    g.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  g.lineTo(last.x, last.y);
}

export interface TerrainLayer {
  /** Заливки, реки и сетка — под территорией. */
  readonly base: Container;
  /** Узоры и берег — над территорией. */
  readonly overlay: Container;
  /** Масштаб и уровень детализации: шейдер обновляется сразу, реки — после паузы зума. */
  update(scale: number, level: DetailLevel): void;
  destroy(): void;
}

/** Строит слои рельефа для карты при заданном радиусе гекса. */
export function createTerrainLayer(map: MapStatic, radius: number): TerrainLayer {
  const gpu = createTerrainGpu(map, radius);
  const rivers = new Graphics();
  const base = new Container();
  base.addChild(gpu.base, rivers);
  const overlay = new Container();
  overlay.addChild(gpu.over);
  const riverChains = chainSegments(
    Array.from(map.terrain, (_, id) => id).flatMap((id) => {
      const h = hexFromId(id, map.width);
      const center = hexCenter(h, radius);
      return [0, 1, 2]
        .filter((d) => ((map.rivers[id] ?? 0) & (1 << d)) !== 0)
        .map((d) => hexEdge(center, radius, d));
    }),
  );
  const gate = createTerrainRedrawGate();
  return {
    base,
    overlay,
    update(scale, level) {
      gpu.setScale(scale, level);
      if (!gate.shouldRedraw(scale, level, performance.now())) return;
      rivers.clear();
      for (const chain of riverChains) drawSmooth(rivers, chain);
      const riverWidth = M.riverWidth[level - 1] ?? M.riverWidth[1];
      rivers.stroke({ color: M.river, width: riverWidth / scale, cap: 'round', join: 'round' });
    },
    destroy() {
      gpu.destroy();
      base.destroy({ children: true, context: true });
      overlay.destroy({ children: true, context: true });
    },
  };
}
