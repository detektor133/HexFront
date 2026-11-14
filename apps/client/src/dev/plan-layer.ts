// Планы армий на карте как в HoI4 (CR-004; art/units.md, «Линии планов»): фронт — тонкая линия
// цвета армии по граням на белой подложке, у выбранной армии — ручки на концах; линия
// наступления — пунктир `arrow.color` гладкой кривой по граням и широкие полупрозрачные стрелки
// к ней; линия обороны — через центры гексов с зубцами к врагу; прогноз у линии; черновик.
import { Container, Graphics } from 'pixi.js';

import {
  edgeHex,
  edgeHexes,
  edgeOther,
  facingEdges,
  lineDistance,
  type EdgeId,
  type MapStatic,
  type PlanView,
  type PlayerView,
} from '@hexfront/sim';

import type { FrontTweenCacheTelemetry } from './cache-telemetry.ts';
import { createFrontTweens } from './front-tween.ts';
import {
  arrowCount,
  arrowShape,
  offensiveArrows,
  offensiveCurve,
  pathLength,
} from './plan-arrows.ts';
import { draftPath, frontHandles, type Draft } from './plan-draft.ts';
import { edgeRuns } from './plan-edges.ts';
import { dashedPath } from './unit-layer.ts';
import type { DetailLevel } from '../render/camera.ts';
import type { Point } from '../render/hex-geometry.ts';
import { armyColor } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Черновик: подсветка линии — доля непрозрачности. */
const DRAFT_ALPHA = 0.6;

export interface PlanLayer {
  readonly container: Container;
  setView(
    view: PlayerView,
    draft: Draft | null,
    selectedArmy: number | null,
    scale: number,
    level: DetailLevel,
  ): void;
  setHover(world: Point | null): void;
  /** Кадр: пока линия фронта перетекает в новое положение, слой перерисовывается. */
  frame(nowMs: number): void;
  cacheTelemetry(): FrontTweenCacheTelemetry;
  destroy(): void;
}

type FrontPlan = PlanView & { kind: 'front' };

export interface FrontAppearance {
  readonly alpha: number;
  readonly detailShift: number;
  readonly width: number;
}

export function frontAppearance(
  selectedArmy: number | null,
  armyId: number,
  level: number,
): FrontAppearance {
  const selected = selectedArmy === armyId;
  const index = Math.min(tokens.front.width.length - 1, Math.max(0, level));
  const widthIndex = Math.min(tokens.front.width.length - 1, index + (selected ? 1 : 0));
  return {
    alpha: 1,
    detailShift: selected ? 1 : 0,
    width: tokens.front.width[widthIndex] ?? tokens.front.width[1] ?? 3,
  };
}

/** Возвращает поперечные штрихи по полилинии; длины указаны в мировых px. */
export function frontTickSegments(
  points: readonly Point[],
  tickLength: number,
  tickSpacing: number,
): Point[][] {
  if (points.length < 2 || tickLength <= 0 || tickSpacing <= 0) return [];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    total += length;
  }
  const ticks: Point[][] = [];
  for (let distance = 0; distance <= total; distance += tickSpacing) {
    let offset = distance;
    let segment = 0;
    while (segment < lengths.length - 1 && offset > (lengths[segment] ?? 0)) {
      offset -= lengths[segment] ?? 0;
      segment += 1;
    }
    const a = points[segment] as Point;
    const b = points[segment + 1] as Point;
    const length = lengths[segment] ?? 0;
    if (length === 0) continue;
    const x = a.x + ((b.x - a.x) * Math.min(offset, length)) / length;
    const y = a.y + ((b.y - a.y) * Math.min(offset, length)) / length;
    const nx = (-(b.y - a.y) / length) * (tickLength / 2);
    const ny = ((b.x - a.x) / length) * (tickLength / 2);
    ticks.push([
      { x: x - nx, y: y - ny },
      { x: x + nx, y: y + ny },
    ]);
  }
  return ticks;
}

/** Проверяет попадание указателя в линию наступления с допуском в экранных px. */
export function isPointNearPath(
  point: Point,
  paths: readonly (readonly Point[])[],
  threshold: number,
): boolean {
  const distanceToSegment = (a: Point, b: Point): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
    const t = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
    );
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
  };
  return paths.some((path) =>
    path.some((p, i) => i > 0 && distanceToSegment(path[i - 1] as Point, p) <= threshold),
  );
}

/** Создаёт слой; center — центр гекса в мировых координатах. */
/** Сколько слоёв линий фронта на одном участке рисуется отдельно (дальше — в последнем слое). */
const LAYER_MAX = 2;
/** Сдвиг каждого следующего слоя вглубь своей земли, долей радиуса гекса. */
const LAYER_STEP = 0.3;

/**
 * Сдвигает линию внутрь своей земли: каждая точка идёт к ближайшему центру своего гекса у фронта.
 * @param amount сдвиг в мировых единицах
 */
export function shiftInward(
  runs: readonly Point[][],
  centers: readonly Point[],
  amount: number,
): Point[][] {
  if (centers.length === 0 || amount <= 0) return runs.map((r) => [...r]);
  return runs.map((run) =>
    run.map((pt) => {
      let best = centers[0] as Point;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const c of centers) {
        const d = Math.hypot(c.x - pt.x, c.y - pt.y);
        if (d < bestDist) {
          best = c;
          bestDist = d;
        }
      }
      if (bestDist === 0) return pt;
      const t = Math.min(1, amount / bestDist);
      return { x: pt.x + (best.x - pt.x) * t, y: pt.y + (best.y - pt.y) * t };
    }),
  );
}

export function createPlanLayer(
  map: MapStatic,
  radius: number,
  center: (hex: number) => Point,
): PlanLayer {
  const container = new Container();
  const arrows = new Graphics();
  const g = new Graphics();
  const labels = new Container();
  // Стрелки — поверх линий планов: белая подложка фронта не режет наконечник на части.
  container.addChild(g, arrows, labels);
  let k = 1;
  let level: DetailLevel = 2;

  const width = (w: readonly number[], detailShift = 0): number => {
    const index = Math.min(w.length - 1, Math.max(0, level - 1 + detailShift));
    return (w[index] ?? w[1] ?? 3) * k;
  };
  // Геометрия граней не меняется, пока не изменились сами грани: кэш по ключу спасает от пересчёта
  // каждый тик, при наведении и в кадрах перехода.
  const runCache = new Map<string, Point[][]>();
  const runsOf = (edges: readonly EdgeId[]): Point[][] => {
    const key = edges.join(',');
    const hit = runCache.get(key);
    if (hit) return hit;
    if (runCache.size > 256) runCache.clear();
    const runs = edgeRuns(map, radius, edges);
    runCache.set(key, runs);
    return runs;
  };
  // «Центр тяжести» чужой земли считается обходом всей карты — пересчитываем лишь при смене владельцев.
  let enemyCache: { owner: unknown; player: number; x: number; y: number; n: number } | null = null;
  const enemyCentroid = (v: PlayerView): { x: number; y: number; n: number } => {
    if (enemyCache && enemyCache.owner === v.hexes.owner && enemyCache.player === v.playerId) {
      return enemyCache;
    }
    let x = 0;
    let y = 0;
    let n = 0;
    v.hexes.owner.forEach((o, id) => {
      if (o < 0 || o === v.playerId) return;
      const c = center(id);
      x += c.x;
      y += c.y;
      n += 1;
    });
    enemyCache = { owner: v.hexes.owner, player: v.playerId, x, y, n };
    return enemyCache;
  };

  function polyline(pts: readonly Point[]): void {
    const [first, ...rest] = pts;
    if (!first) return;
    g.moveTo(first.x, first.y);
    for (const p of rest) g.lineTo(p.x, p.y);
  }

  function drawFront(runs: readonly Point[][], color: string, alpha = 1, detailShift = 0): void {
    const w = width(tokens.front.width, detailShift);
    const style = { cap: 'round', join: 'round', alpha } as const;
    for (const r of runs) polyline(r);
    g.stroke({
      ...style,
      alpha: 1,
      color: tokens.front.casing,
      width: w + 2 * tokens.front.casingWidth * k,
    });
    for (const r of runs) polyline(r);
    g.stroke({ ...style, color, width: w });
    const ticks = runs.flatMap((run) =>
      frontTickSegments(run, tokens.front.tickLength * k, tokens.front.tickSpacing * k),
    );
    for (const tick of ticks) {
      const [a, b] = tick;
      if (!a || !b) continue;
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    if (ticks.length > 0) {
      g.stroke({ ...style, color, width: tokens.front.tickWidth * k });
    }
  }

  function drawHandles(points: readonly Point[], color: string): void {
    const r = tokens.front.handleRadius * k;
    for (const p of points) {
      g.circle(p.x, p.y, r)
        .fill(tokens.ui.surface)
        .stroke({ color, width: 2.5 * k });
    }
  }

  // Зубцы — к «центру тяжести» чужой земли: с какой стороны линии враг.
  function drawDefense(v: PlayerView, hexes: readonly number[], color: string, alpha = 1): void {
    const pts = hexes.map(center);
    const [first] = pts;
    if (!first) return;
    const w = width(tokens.front.width);
    const { x: ex, y: ey, n } = enemyCentroid(v);
    const style = { cap: 'round', join: 'round', alpha } as const;
    polyline(pts);
    g.stroke({ ...style, color: tokens.front.casing, width: w + 2 * tokens.front.casingWidth * k });
    polyline(pts);
    if (pts.length === 1) g.circle(first.x, first.y, w);
    g.stroke({ ...style, color, width: w });
    const { length, spacing } = tokens.armies.defenseTeeth;
    const tl = length * k + w / 2;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1] as Point;
      const b = pts[i] as Point;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l === 0) continue;
      let nx = -(b.y - a.y) / l;
      let ny = (b.x - a.x) / l;
      if (n > 0 && (ex / n - a.x) * nx + (ey / n - a.y) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      for (let s = (spacing * k) / 2; s < l; s += spacing * k) {
        const x = a.x + ((b.x - a.x) * s) / l;
        const y = a.y + ((b.y - a.y) * s) / l;
        g.moveTo(x, y).lineTo(x + nx * tl, y + ny * tl);
      }
    }
    g.stroke({ ...style, color, width: Math.max(1, w * 0.7) });
  }

  // Широкая полупрозрачная стрелка от фронта к линии наступления, как в HoI4 (мировые размеры).
  function drawArrow(from: Point, to: Point, alpha: number): void {
    const shape = arrowShape(from, to, tokens.arrow, radius);
    if (shape.length === 0) return;
    arrows.poly(shape.flatMap((p) => [p.x, p.y])).fill({ color: tokens.arrow.color, alpha });
  }

  // Линия наступления как в HoI4: гладкая кривая по серединам граней (пунктир — только нарисована,
  // сплошная — идёт) и 1–3 стрелки от смотрящего на линию участка фронта: хвосты и концы
  // равномерно, попарно по порядку, без пересечений (art/units.md, «Линия наступления»).
  function drawOffensiveLine(
    facing: readonly EdgeId[],
    line: readonly EdgeId[],
    active: boolean,
    alpha = 1,
  ): Point[] {
    const runs = runsOf(line).map(offensiveCurve);
    const [dash = 8, gap = 5] = tokens.arrow.dash;
    for (const r of runs) {
      if (active) polyline(r);
      else dashedPath(g, r, dash * k, gap * k, 0);
    }
    g.stroke({
      color: tokens.arrow.color,
      width: width(tokens.arrow.width),
      cap: 'round',
      join: 'round',
      alpha,
    });
    // Хвосты — только на смотрящем участке текущего фронта; число — по его ширине в гексах.
    const tails = runsOf(facing);
    const n = arrowCount(edgeHexes(facing).length);
    const arrowAlpha = (active ? tokens.arrow.alpha : tokens.arrow.plannedAlpha) * alpha;
    const long = (rs: readonly Point[][]): boolean => rs.some((r) => pathLength(r) > 0);
    if (long(tails) && long(runs)) {
      for (const [from, to] of offensiveArrows(tails, runs, n)) drawArrow(from, to, arrowAlpha);
    }
    return runs.flat();
  }

  function drawOffensive(p: FrontPlan): void {
    if (!p.offensive) return;
    drawOffensiveLine(p.facing, p.offensive.edges, p.offensive.active);
  }

  function drawDraft(v: PlayerView, d: Draft, color: string): void {
    const path = draftPath({ map, view: v, radius }, d);
    const plan = v.plans.find((p) => p.armyId === d.armyId);
    if (d.tool === 'front') drawFront(runsOf(path.edges), color, DRAFT_ALPHA);
    else if (d.tool === 'line') drawDefense(v, path.hexes, color, DRAFT_ALPHA);
    else if (d.tool === 'offensive') {
      // Черновик: гексы линии ещё не выбраны sim — считаем от обеих сторон её граней.
      const g0 = { map, hexes: v.hexes };
      const both = path.edges.flatMap((e) => [edgeHex(e), edgeOther(g0, e)]).filter((h) => h >= 0);
      const facing =
        plan?.kind === 'front' ? facingEdges(g0, plan.edges, lineDistance(g0, both)) : [];
      drawOffensiveLine(facing, path.edges, false, DRAFT_ALPHA);
    }
  }

  const tweens = createFrontTweens();
  let last: Parameters<PlanLayer['setView']> | null = null;
  let animating = false;

  return {
    container,
    setView(v, draft, selectedArmy, scale, lvl) {
      last = [v, draft, selectedArmy, scale, lvl];
      const now = performance.now();
      k = 1 / scale;
      level = lvl;
      g.clear();
      arrows.clear();
      for (const tx of labels.removeChildren()) tx.destroy();
      const colorOf = (armyId: number): string | null => {
        const army = v.armies.find((a) => a.id === armyId);
        return army ? armyColor(army.number) : null;
      };
      // Слои: армии на одном участке границы не рисуются друг поверх друга — каждая следующая
      // линия сдвинута вглубь своей земли (армия на весь блок и усиление одной страны).
      const taken = new Map<number, number>();
      const layerOf = new Map<number, number>();
      for (const p of v.plans) {
        if (p.kind !== 'front') continue;
        let layer = 0;
        for (const e of p.edges) layer = Math.max(layer, taken.get(e) ?? 0);
        for (const e of p.edges) taken.set(e, Math.max(taken.get(e) ?? 0, layer + 1));
        layerOf.set(p.armyId, Math.min(layer, LAYER_MAX));
      }
      for (const p of v.plans) {
        const color = colorOf(p.armyId);
        if (!color) continue;
        if (p.kind === 'line') {
          drawDefense(v, p.hexes, color);
          continue;
        }
        const layer = layerOf.get(p.armyId) ?? 0;
        const tweened = tweens.runs(p.armyId, p.edges.join(','), runsOf(p.edges), now);
        const front =
          layer === 0
            ? tweened
            : shiftInward(tweened, p.hexes.map(center), layer * LAYER_STEP * radius);
        drawOffensive(p);
        const appearance = frontAppearance(selectedArmy, p.armyId, level - 1);
        drawFront(front, color, appearance.alpha, appearance.detailShift);
        if (p.armyId === selectedArmy && !draft) {
          drawHandles(frontHandles({ map, view: v, radius }, p), color);
        }
      }
      tweens.keep(new Set(v.plans.filter((p) => p.kind === 'front').map((p) => p.armyId)));
      animating = tweens.active(now);
      const dc = draft ? colorOf(draft.armyId) : null;
      if (draft && dc) drawDraft(v, draft, dc);
    },
    setHover() {
      // Значка прогноза у линии нет — наведение слою не нужно.
    },
    frame(nowMs) {
      // Ещё один кадр после конца перехода — линия встаёт точно в новое положение.
      if (!animating || !last) return;
      animating = tweens.active(nowMs);
      this.setView(...last);
    },
    cacheTelemetry() {
      return tweens.cacheTelemetry();
    },
    destroy() {
      container.destroy({ children: true, context: true });
    },
  };
}
