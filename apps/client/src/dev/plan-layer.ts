// Планы армий на карте как в HoI4 (CR-004; art/units.md, «Линии планов»): фронт — тонкая линия
// цвета армии по граням на белой подложке, у выбранной армии — ручки на концах; линия
// наступления — пунктир `arrow.color` гладкой кривой по граням и широкие полупрозрачные стрелки
// к ней; линия обороны — через центры гексов с зубцами к врагу; прогноз у линии; черновик.
import { Container, Graphics, Text } from 'pixi.js';

import {
  edgeHex,
  edgeHexes,
  edgeOther,
  facingEdges,
  forecastBattle,
  lineDistance,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  type EdgeId,
  type Forecast,
  type ForecastOutcome,
  type MapStatic,
  type PlanView,
  type PlayerView,
} from '@hexfront/sim';

import { drawForecastPlate, forecastBadge } from './forecast-plate.ts';
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
import { isHostile } from './sandbox-selection.ts';
import type { SplitOverlay } from './split-drag.ts';
import { dashedPath } from './unit-layer.ts';
import type { DetailLevel } from '../render/camera.ts';
import type { Point } from '../render/hex-geometry.ts';
import { armyColor } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Черновик: подсветка линии — доля непрозрачности. */
const DRAFT_ALPHA = 0.6;
/** Прогноз у линии: кегль и подъём над точкой, px экрана. */
const LABEL_PX = 13;
const LABEL_LIFT = 14;
const RANK: Record<ForecastOutcome, number> = { defeat: 0, stalemate: 1, victory: 2 };

export interface PlanLayer {
  readonly container: Container;
  setView(
    view: PlayerView,
    draft: Draft | null,
    selectedArmy: number | null,
    split: SplitOverlay | null,
    scale: number,
    level: DetailLevel,
  ): void;
  /** Кадр: пока линия фронта перетекает в новое положение, слой перерисовывается. */
  frame(nowMs: number): void;
  destroy(): void;
}

type FrontPlan = PlanView & { kind: 'front' };

/** Создаёт слой; center — центр гекса в мировых координатах. */
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

  const width = (w: readonly number[]): number => (w[level - 1] ?? w[1] ?? 3) * k;
  const runsOf = (edges: readonly EdgeId[]): Point[][] => edgeRuns(map, radius, edges);

  function polyline(pts: readonly Point[]): void {
    const [first, ...rest] = pts;
    if (!first) return;
    g.moveTo(first.x, first.y);
    for (const p of rest) g.lineTo(p.x, p.y);
  }

  function drawFront(runs: readonly Point[][], color: string, alpha = 1): void {
    const w = width(tokens.front.width);
    const style = { cap: 'round', join: 'round', alpha } as const;
    for (const r of runs) polyline(r);
    g.stroke({ ...style, color: tokens.front.casing, width: w + 2 * tokens.front.casingWidth * k });
    for (const r of runs) polyline(r);
    g.stroke({ ...style, color, width: w });
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
    let ex = 0;
    let ey = 0;
    let n = 0;
    v.hexes.owner.forEach((o, id) => {
      if (o < 0 || o === v.playerId) return;
      const c = center(id);
      ex += c.x;
      ey += c.y;
      n += 1;
    });
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

  // Самый трудный из ближайших боёв: отряды армии рядом с занятыми врагом гексами зоны.
  // Самый трудный бой — худший исход, при равенстве — больше свои потери.
  function worstForecast(v: PlayerView, p: FrontPlan): Forecast | null {
    const zone = new Set(p.zone);
    let worst: Forecast | null = null;
    for (const u of v.units) {
      if (u.armyId !== p.armyId || u.type === 'artillery') continue;
      for (const n of neighbors(hexFromId(u.hex, map.width))) {
        if (!inBounds(n, map.width, map.height)) continue;
        const id = hexId(n, map.width);
        if (!zone.has(id) || !isHostile(v, id)) continue;
        const f = forecastBattle(map, v, [u.id], id);
        const harder =
          worst === null ||
          RANK[f.outcome] < RANK[worst.outcome] ||
          (RANK[f.outcome] === RANK[worst.outcome] && f.attackerLoss > worst.attackerLoss);
        if (harder) worst = f;
      }
    }
    return worst;
  }

  function label(text: string, color: string, at: Point): void {
    const tx = new Text({
      text,
      style: {
        fontFamily: tokens.font.ui.family,
        fontWeight: '500',
        fontSize: LABEL_PX,
        fill: color,
        stroke: { color: tokens.ui.surface, width: tokens.city.labelHalo },
      },
    });
    tx.resolution = window.devicePixelRatio * 2;
    tx.anchor.set(0.5, 1);
    tx.scale.set(k);
    tx.position.set(at.x, at.y - LABEL_LIFT * k);
    labels.addChild(tx);
  }

  function drawOffensive(v: PlayerView, p: FrontPlan): void {
    if (!p.offensive) return;
    const pts = drawOffensiveLine(p.facing, p.offensive.edges, p.offensive.active);
    const worst = worstForecast(v, p);
    const mid = pts[Math.floor(pts.length / 2)];
    // У линии — плашка прогноза без слов: иконка и цвет исхода + свои потери (art/units.md).
    if (worst && mid) drawForecastPlate(labels, forecastBadge(worst), mid, k);
  }

  // Кольцо деления: подложка, дуга «сколько взять» от верха по часовой, ручка, число; путь в гекс.
  function drawSplit(o: SplitOverlay): void {
    const { center: c, ring } = o;
    if (o.target !== null) {
      const t = center(o.target);
      dashedPath(g, [c, t], 6 * k, 5 * k, 0);
      g.stroke({ color: tokens.relation.own, width: 2.5 * k, cap: 'round' });
      g.circle(t.x, t.y, 6 * k)
        .fill(tokens.ui.surface)
        .stroke({ color: tokens.relation.own, width: 2.5 * k });
    }
    g.circle(c.x, c.y, ring).stroke({ color: tokens.ui.surface, width: 8 * k, alpha: 0.95 });
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * o.share;
    g.arc(c.x, c.y, ring, start, end).stroke({
      color: tokens.relation.own,
      width: 5 * k,
      cap: 'round',
    });
    const kx = c.x + Math.cos(end) * ring;
    const ky = c.y + Math.sin(end) * ring;
    g.circle(kx, ky, 6 * k)
      .fill(tokens.ui.surface)
      .stroke({ color: tokens.relation.own, width: 2.5 * k });
    label(String(o.amount), tokens.ui.ink, { x: c.x, y: c.y - ring - 4 * k });
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

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tweens = createFrontTweens(reduced);
  let last: Parameters<PlanLayer['setView']> | null = null;
  let animating = false;

  return {
    container,
    setView(v, draft, selectedArmy, split, scale, lvl) {
      last = [v, draft, selectedArmy, split, scale, lvl];
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
      for (const p of v.plans) {
        const color = colorOf(p.armyId);
        if (!color) continue;
        if (p.kind === 'line') {
          drawDefense(v, p.hexes, color);
          continue;
        }
        const front = tweens.runs(p.armyId, p.edges.join(','), runsOf(p.edges), now);
        drawOffensive(v, p);
        drawFront(front, color);
        if (p.armyId === selectedArmy && !draft) {
          drawHandles(frontHandles({ map, view: v, radius }, p), color);
        }
      }
      tweens.keep(new Set(v.plans.filter((p) => p.kind === 'front').map((p) => p.armyId)));
      animating = tweens.active(now);
      const dc = draft ? colorOf(draft.armyId) : null;
      if (draft && dc) drawDraft(v, draft, dc);
      if (split) drawSplit(split);
    },
    frame(nowMs) {
      // Ещё один кадр после конца перехода — линия встаёт точно в новое положение.
      if (!animating || !last) return;
      animating = tweens.active(nowMs);
      this.setView(...last);
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
