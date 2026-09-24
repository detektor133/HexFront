// Слои карты 1–3 (вода, рельеф с паттернами, реки) и сетка гексов.
// Правила: docs/art/style-guide.md, «Слои карты»; цвета и толщины — tokens.json.
import { Container, Graphics } from 'pixi.js';

import {
  TERRAIN,
  hexFromId,
  hexId,
  inBounds,
  neighbor,
  type Direction,
  type MapStatic,
} from '@hexfront/sim';

import type { DetailLevel } from './camera.ts';
import { hexCenter, hexEdge, hexPolygon, type Point } from './hex-geometry.ts';
import { chainSegments } from './river-paths.ts';
import { tokens } from '../theme/tokens.ts';

const { map: M } = tokens;

// Пропорции паттернов в долях радиуса гекса: геометрия знака, а не цвет или толщина.
const DOT_SPREAD = 0.55;
const DOT_RADIUS = 0.07;
const FOREST_DOTS = 4;
const DESERT_DOTS = 3;
const CONTOUR_STEP = 0.22;
const CONTOUR_HALF = 0.55;
const CONTOUR_TAPER = 0.12;
const CONTOUR_JITTER = 0.2;
const HATCH_LINES = 3;
const HATCH_START_X = 0.1;
const HATCH_STEP_X = 0.12;
const HATCH_TOP = 0.15;
const HATCH_BOTTOM = 0.45;
const HATCH_SLANT = 0.1;

const TERRAIN_FILL: Readonly<Record<number, string>> = {
  [TERRAIN.water]: M.water,
  [TERRAIN.plains]: M.terrain.plains,
  [TERRAIN.forest]: M.terrain.forest,
  [TERRAIN.hills]: M.terrain.hills,
  [TERRAIN.mountains]: M.terrain.mountains,
  [TERRAIN.desert]: M.terrain.desert,
};

/** Детерминированное «случайное» число 0..1 от координат гекса и номера признака. */
export function hexNoise(q: number, r: number, salt: number): number {
  let h = Math.imul(q, 0x27d4eb2d) ^ Math.imul(r, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

interface HexCell {
  readonly id: number;
  readonly q: number;
  readonly r: number;
  readonly terrain: number;
  readonly center: Point;
}

function cellsOf(map: MapStatic, radius: number): HexCell[] {
  return Array.from(map.terrain, (terrain, id) => {
    const h = hexFromId(id, map.width);
    return { id, q: h.q, r: h.r, terrain, center: hexCenter(h, radius) };
  });
}

// Точки леса и пустыни — заливка, масштабируются с картой вместе с гексом.
function drawDots(g: Graphics, cell: HexCell, radius: number, count: number, color: string): void {
  for (let i = 0; i < count; i += 1) {
    const angle = hexNoise(cell.q, cell.r, i * 2) * Math.PI * 2;
    const dist = hexNoise(cell.q, cell.r, i * 2 + 1) * radius * DOT_SPREAD;
    g.circle(
      cell.center.x + Math.cos(angle) * dist,
      cell.center.y + Math.sin(angle) * dist,
      radius * DOT_RADIUS,
    );
  }
  g.fill(color);
}

// Горизонтали: холмы — 2, горы — 3–4 плюс штриховка склона. Толщина — экранная, задаётся в update().
function addContours(g: Graphics, cell: HexCell, radius: number): void {
  const { x, y } = cell.center;
  const isMountain = cell.terrain === TERRAIN.mountains;
  const lines = isMountain ? 3 + Math.floor(hexNoise(cell.q, cell.r, 7) * 2) : 2;
  const shift = (hexNoise(cell.q, cell.r, 8) - 0.5) * radius * CONTOUR_JITTER;
  for (let i = 0; i < lines; i += 1) {
    const dy = (i - (lines - 1) / 2) * radius * CONTOUR_STEP + shift;
    const half = radius * (CONTOUR_HALF - Math.abs(i - (lines - 1) / 2) * CONTOUR_TAPER);
    g.moveTo(x - half, y + dy).lineTo(x + half, y + dy);
  }
  if (!isMountain) return;
  for (let i = 0; i < HATCH_LINES; i += 1) {
    const sx = x + radius * (HATCH_START_X + i * HATCH_STEP_X);
    g.moveTo(sx, y + radius * HATCH_TOP).lineTo(
      sx + radius * HATCH_SLANT,
      y + radius * HATCH_BOTTOM,
    );
  }
}

// Ломаная по рёбрам сглаживается кривыми через середины звеньев; концы остаются на месте.
function drawSmooth(g: Graphics, points: readonly Point[]): void {
  const [first, ...rest] = points;
  const last = rest.at(-1);
  if (!first || !last) return;
  g.moveTo(first.x, first.y);
  for (let i = 0; i < rest.length - 1; i += 1) {
    const p = rest[i] as Point;
    const next = rest[i + 1] as Point;
    g.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  g.lineTo(last.x, last.y);
}

export interface TerrainLayer {
  readonly container: Container;
  /** Перерисовка экранных толщин под текущий масштаб и уровень детализации. */
  update(scale: number, level: DetailLevel): void;
  destroy(): void;
}

function drawBase(cells: readonly HexCell[], radius: number): Graphics {
  const g = new Graphics();
  for (const cell of cells) {
    g.poly(hexPolygon(cell.center, radius)).fill(TERRAIN_FILL[cell.terrain] ?? M.background);
  }
  for (const cell of cells) {
    if (cell.terrain === TERRAIN.forest)
      drawDots(g, cell, radius, FOREST_DOTS, M.terrain.forestDot);
    if (cell.terrain === TERRAIN.desert)
      drawDots(g, cell, radius, DESERT_DOTS, M.terrain.desertDot);
  }
  return g;
}

function neighborTerrain(map: MapStatic, cell: HexCell, d: Direction): number {
  const n = neighbor(cell, d);
  // За краем карты считаем море, чтобы край не рисовался берегом.
  if (!inBounds(n, map.width, map.height)) return TERRAIN.water;
  return map.terrain[hexId(n, map.width)] ?? TERRAIN.water;
}

// Берег — линия 1 px по рёбрам вода/суша (style-guide, слой 1); рисуется поверх сетки,
// иначе белая сетка его перекрывает.
function drawCoast(map: MapStatic, cells: readonly HexCell[], radius: number): Graphics {
  const g = new Graphics();
  for (const cell of cells) {
    if (cell.terrain !== TERRAIN.water) continue;
    for (const d of [0, 1, 2, 3, 4, 5] as const) {
      if (neighborTerrain(map, cell, d) === TERRAIN.water) continue;
      const [a, b] = hexEdge(cell.center, radius, d);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
  }
  g.stroke({ color: M.waterEdge, width: 1, pixelLine: true });
  return g;
}

function drawGrid(cells: readonly HexCell[], radius: number): Graphics {
  const g = new Graphics();
  for (const cell of cells) g.poly(hexPolygon(cell.center, radius));
  g.stroke({ color: M.hexGrid, alpha: M.hexGridAlpha, width: 1, pixelLine: true });
  return g;
}

/** Строит слои рельефа для карты при заданном радиусе гекса. */
export function createTerrainLayer(map: MapStatic, radius: number): TerrainLayer {
  const cells = cellsOf(map, radius);
  const container = new Container();
  const base = drawBase(cells, radius);
  const contours = new Graphics();
  const rivers = new Graphics();
  const grid = drawGrid(cells, radius);
  container.addChild(base, contours, rivers, grid, drawCoast(map, cells, radius));

  const relief = cells.filter(
    (c) => c.terrain === TERRAIN.hills || c.terrain === TERRAIN.mountains,
  );
  const riverChains = chainSegments(
    cells.flatMap((cell) =>
      [0, 1, 2]
        .filter((d) => ((map.rivers[cell.id] ?? 0) & (1 << d)) !== 0)
        .map((d) => hexEdge(cell.center, radius, d)),
    ),
  );

  return {
    container,
    update(scale, level) {
      // Толщины в токенах — экранные px, поэтому в мировых единицах делим на масштаб.
      contours.clear();
      for (const cell of relief) addContours(contours, cell, radius);
      contours.stroke({
        color: M.contour,
        alpha: M.contourAlpha,
        width: M.contourWidth / scale,
        cap: 'round',
      });
      rivers.clear();
      for (const chain of riverChains) drawSmooth(rivers, chain);
      const riverWidth = M.riverWidth[level - 1] ?? M.riverWidth[1];
      rivers.stroke({ color: M.river, width: riverWidth / scale, cap: 'round', join: 'round' });
      grid.visible = level >= M.hexGridVisibleFromZoom;
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
