// Слои карты 1–3 (вода, рельеф с узорами, реки) и сетка гексов.
// Правила: docs/art/style-guide.md, «Слои карты»; цвета и толщины — tokens.json.
// Заливки и узоры — отдельные контейнеры: между ними ложится территория, узоры остаются читаемыми.
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
const T = M.terrain;

// Геометрия узоров в долях радиуса гекса.
const CROWN_RADIUS = 0.17;
const CROWN_SPREAD = 0.3;
const HILL_HALF_WIDTH = 0.28;
const HILL_HEIGHT = 0.3;
const PEAK_HALF_WIDTH = 0.48;
const PEAK_TOP = 0.42;
const PEAK_BASE = 0.3;
const HATCH_LINES = 3;
const HATCH_SLANT = 0.18;
const RIPPLE_HALF = 0.3;
const RIPPLE_AMPLITUDE = 0.08;
const RIPPLE_STEP = 0.24;
const JITTER = 0.12;

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

function fillOf(terrain: number): string {
  switch (terrain) {
    case TERRAIN.water:
      return M.water;
    case TERRAIN.forest:
      return T.forest;
    case TERRAIN.hills:
      return T.hills;
    case TERRAIN.mountains:
      return T.mountains;
    case TERRAIN.desert:
      return T.desert;
    default:
      return T.plains;
  }
}

// Сдвиг узора внутри гекса, чтобы соседние гексы не выглядели штампом.
function jittered(cell: HexCell, radius: number): Point {
  return {
    x: cell.center.x + (hexNoise(cell.q, cell.r, 1) - 0.5) * radius * JITTER * 2,
    y: cell.center.y + (hexNoise(cell.q, cell.r, 2) - 0.5) * radius * JITTER * 2,
  };
}

// Лес — три кроны треугольником; заливка масштабируется вместе с картой.
function snap(value: number, scale: number): number {
  const dpr = globalThis.devicePixelRatio ?? 1;
  return Math.round(value * scale * dpr) / (scale * dpr);
}

function drawCrowns(g: Graphics, c: Point, radius: number, scale: number): void {
  const s = radius * CROWN_SPREAD;
  for (const [dx, dy] of [
    [0, -0.6],
    [-0.8, 0.45],
    [0.8, 0.45],
  ] as const) {
    g.circle(snap(c.x + dx * s, scale), snap(c.y + dy * s, scale), radius * CROWN_RADIUS);
  }
}

// Холмы — две дуги-«горба», правая чуть ниже.
function addHills(g: Graphics, c: Point, radius: number, scale: number): void {
  const w = radius * HILL_HALF_WIDTH;
  const h = radius * HILL_HEIGHT;
  for (const [dx, dy] of [
    [-0.55, -0.05],
    [0.55, 0.2],
  ] as const) {
    const x = c.x + dx * w * 1.6;
    const y = c.y + dy * radius;
    g.moveTo(snap(x - w, scale), snap(y, scale)).quadraticCurveTo(
      snap(x, scale),
      snap(y - h * 2, scale),
      snap(x + w, scale),
      snap(y, scale),
    );
  }
}

// Горы — пик и штриховка теневого (правого) склона.
function addMountain(g: Graphics, c: Point, radius: number, scale: number): void {
  const w = radius * PEAK_HALF_WIDTH;
  const top = c.y - radius * PEAK_TOP;
  const base = c.y + radius * PEAK_BASE;
  g.moveTo(snap(c.x - w, scale), snap(base, scale))
    .lineTo(snap(c.x, scale), snap(top, scale))
    .lineTo(snap(c.x + w, scale), snap(base, scale));
  for (let i = 1; i <= HATCH_LINES; i += 1) {
    const t = i / (HATCH_LINES + 1);
    g.moveTo(snap(c.x + w * t, scale), snap(top + (base - top) * t, scale)).lineTo(
      snap(c.x + w * t - w * HATCH_SLANT, scale),
      snap(base, scale),
    );
  }
}

// Пустыня — две строки ряби.
function addRipple(g: Graphics, c: Point, radius: number, scale: number): void {
  const half = radius * RIPPLE_HALF;
  const a = radius * RIPPLE_AMPLITUDE;
  for (const dy of [-0.5, 0.5]) {
    const y = c.y + dy * radius * RIPPLE_STEP * 2;
    const x0 = c.x - half + dy * half * 0.4;
    g.moveTo(snap(x0, scale), snap(y, scale))
      .quadraticCurveTo(
        snap(x0 + half * 0.5, scale),
        snap(y - a * 2, scale),
        snap(x0 + half, scale),
        snap(y, scale),
      )
      .quadraticCurveTo(
        snap(x0 + half * 1.5, scale),
        snap(y + a * 2, scale),
        snap(x0 + half * 2, scale),
        snap(y, scale),
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

function neighborTerrain(map: MapStatic, cell: HexCell, d: Direction): number {
  const n = neighbor(cell, d);
  // За краем карты считаем море, чтобы край не рисовался берегом.
  if (!inBounds(n, map.width, map.height)) return TERRAIN.water;
  return map.terrain[hexId(n, map.width)] ?? TERRAIN.water;
}

function drawFills(cells: readonly HexCell[], radius: number): Graphics {
  const g = new Graphics();
  for (const cell of cells) g.poly(hexPolygon(cell.center, radius)).fill(fillOf(cell.terrain));
  return g;
}

// Берег — линия 1 px по рёбрам вода/суша (style-guide, слой 1).
function drawCoast(
  map: MapStatic,
  cells: readonly HexCell[],
  radius: number,
  waterEdge: string,
): Graphics {
  const g = new Graphics();
  for (const cell of cells) {
    if (cell.terrain !== TERRAIN.water) continue;
    for (const d of [0, 1, 2, 3, 4, 5] as const) {
      if (neighborTerrain(map, cell, d) === TERRAIN.water) continue;
      const [a, b] = hexEdge(cell.center, radius, d);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
  }
  g.stroke({ color: waterEdge, width: 1, pixelLine: true });
  return g;
}

function drawGrid(cells: readonly HexCell[], radius: number): Graphics {
  const g = new Graphics();
  for (const cell of cells) g.poly(hexPolygon(cell.center, radius));
  // Ширина в мировых единицах даёт один CSS-пиксель при масштабе 1; pixelLine
  // привязывает линию к физическому пикселю и делает её тоньше на DPR 3.
  g.stroke({ color: M.hexGrid, alpha: M.hexGridAlpha, width: 1 });
  return g;
}

function drawCrownLayer(
  g: Graphics,
  cells: readonly HexCell[],
  radius: number,
  scale: number,
): void {
  for (const cell of cells) {
    if (cell.terrain === TERRAIN.forest) drawCrowns(g, jittered(cell, radius), radius, scale);
  }
  g.fill(T.forestInk);
}

export interface TerrainLayer {
  /** Заливки, реки и сетка — под территорией. */
  readonly base: Container;
  /** Узоры и берег — над территорией. */
  readonly overlay: Container;
  /** Перерисовка экранных толщин под текущий масштаб и уровень детализации. */
  update(scale: number, level: DetailLevel): void;
  destroy(): void;
}

/** Строит слои рельефа для карты при заданном радиусе гекса. */
export function createTerrainLayer(
  map: MapStatic,
  radius: number,
  waterEdge: string = M.waterEdge,
): TerrainLayer {
  const cells = cellsOf(map, radius);
  const rivers = new Graphics();
  const grid = drawGrid(cells, radius);
  const base = new Container();
  base.addChild(drawFills(cells, radius), rivers, grid);
  const crowns = new Graphics();
  const lines = new Graphics();
  const overlay = new Container();
  overlay.addChild(crowns, lines, drawCoast(map, cells, radius, waterEdge));

  const byTerrain = (t: number): HexCell[] => cells.filter((c) => c.terrain === t);
  const forest = byTerrain(TERRAIN.forest);
  const hills = byTerrain(TERRAIN.hills);
  const mountains = byTerrain(TERRAIN.mountains);
  const deserts = byTerrain(TERRAIN.desert);
  const riverChains = chainSegments(
    cells.flatMap((cell) =>
      [0, 1, 2]
        .filter((d) => ((map.rivers[cell.id] ?? 0) & (1 << d)) !== 0)
        .map((d) => hexEdge(cell.center, radius, d)),
    ),
  );
  return {
    base,
    overlay,
    update(scale, level) {
      // Толщины — экранные px, поэтому в мировых единицах делим на масштаб.
      const style = {
        width: M.patternWidth / scale,
        cap: 'round',
        join: 'round',
      } as const;
      crowns.clear();
      drawCrownLayer(crowns, forest, radius, scale);
      lines.clear();
      for (const c of hills) addHills(lines, jittered(c, radius), radius, scale);
      lines.stroke({ ...style, color: T.hillInk });
      for (const c of mountains) addMountain(lines, jittered(c, radius), radius, scale);
      lines.stroke({ ...style, color: T.mountainInk });
      for (const c of deserts) addRipple(lines, jittered(c, radius), radius, scale);
      lines.stroke({ ...style, color: T.desertInk });
      rivers.clear();
      for (const chain of riverChains) drawSmooth(rivers, chain);
      const riverWidth = M.riverWidth[level - 1] ?? M.riverWidth[1];
      rivers.stroke({ color: M.river, width: riverWidth / scale, cap: 'round', join: 'round' });
      grid.visible = level >= M.hexGridVisibleFromZoom;
    },
    destroy() {
      base.destroy({ children: true, context: true });
      overlay.destroy({ children: true, context: true });
    },
  };
}
