// Планы армий на карте (CR-002, CR-003; art/units.md, «Линии планов»): участок фронта — по граням
// своей границы (с врагом или ничьей землёй) на белой подложке, линия обороны — через центры
// гексов с зубцами к врагу, линия наступления — по внешней кромке её гексов с наконечниками
// вперёд и заливкой зоны, прогноз у линии, черновик рисуемого плана. Всё — в цвете армии.
import { Container, Graphics, Text } from 'pixi.js';

import {
  forecastBattle,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  type ForecastOutcome,
  type MapStatic,
  type PlanView,
  type PlayerView,
} from '@hexfront/sim';

import { draftPath, type Draft } from './plan-draft.ts';
import { frontEdges, offensiveEdges, type Edge } from './plan-edges.ts';
import { isHostile } from './sandbox-selection.ts';
import { dashedPath } from './unit-layer.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import type { DetailLevel } from '../render/camera.ts';
import { hexEdge, hexPolygon, type Point } from '../render/hex-geometry.ts';
import { armyColor } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Заливка зоны наступления — 12 % цвета армии (units.md, «Линии планов»). */
const ZONE_ALPHA = 0.12;
/** Бегущий пунктир по активной линии: доля ширины линии, штрих/промежуток и скорость, px экрана. */
const FLOW_SHARE = 0.3;
const FLOW_DASH = 10;
const FLOW_GAP = 14;
const FLOW_SPEED = 20;
/** Черновик: подсветка линии — доля непрозрачности цвета армии. */
const DRAFT_ALPHA = 0.55;
/** Прогноз у линии: кегль и подъём над серединой линии, px экрана. */
const LABEL_PX = 13;
const LABEL_LIFT = 22;
const RANK: Record<ForecastOutcome, number> = { defeat: 0, stalemate: 1, victory: 2 };

export interface PlanLayer {
  readonly container: Container;
  setView(view: PlayerView, draft: Draft | null, scale: number, level: DetailLevel): void;
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
  const g = new Graphics();
  const flow = new Graphics();
  const labels = new Container();
  container.addChild(g, flow, labels);
  let k = 1;
  let level: DetailLevel = 2;
  let active: { segs: [Point, Point][]; width: number }[] = [];

  const seg = (e: Edge): [Point, Point] => hexEdge(center(e.hex), radius, e.d);
  const frontW = (): number => (tokens.front.width[level - 1] ?? tokens.front.width[1]) * k;
  const arrowW = (): number => (tokens.arrow.width[level - 1] ?? tokens.arrow.width[1]) * k;

  function strokeSegs(segs: readonly [Point, Point][], color: string, width: number, alpha = 1) {
    for (const [a, b] of segs) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    g.stroke({ color, width, alpha, cap: 'round', join: 'round' });
  }

  // Фронт по граням: белая подложка, поверх — цвет армии.
  function drawFrontEdges(v: PlayerView, hexes: readonly number[], color: string, alpha = 1) {
    const segs = frontEdges({ map, owner: v.hexes.owner, me: v.playerId }, hexes).map(seg);
    const w = frontW();
    strokeSegs(segs, tokens.front.casing, w + 2 * tokens.front.casingWidth * k, alpha);
    strokeSegs(segs, color, w, alpha);
  }

  // Зубцы — к «центру тяжести» чужой земли: с какой стороны линии враг.
  function drawDefense(v: PlayerView, hexes: readonly number[], color: string, alpha = 1): void {
    const pts = hexes.map(center);
    const [first] = pts;
    if (!first) return;
    const w = frontW();
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
    const line = (): void => {
      g.moveTo(first.x, first.y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      if (pts.length === 1) g.circle(first.x, first.y, w / 2);
    };
    const casing = w + 2 * tokens.front.casingWidth * k;
    line();
    g.stroke({ color: tokens.front.casing, width: casing, alpha, cap: 'round', join: 'round' });
    line();
    g.stroke({ color, width: w, alpha, cap: 'round', join: 'round' });
    const { length, spacing } = tokens.armies.defenseTeeth;
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
      const tl = length * k + w / 2;
      for (let s = (spacing * k) / 2; s < l; s += spacing * k) {
        const x = a.x + ((b.x - a.x) * s) / l;
        const y = a.y + ((b.y - a.y) * s) / l;
        g.moveTo(x, y).lineTo(x + nx * tl, y + ny * tl);
      }
    }
    g.stroke({ color, width: Math.max(1, w / 2), alpha, cap: 'round' });
  }

  // Наконечники на кромке, остриём наружу (из гекса линии в соседа за ней), 2–3 штуки вдоль линии.
  function drawHeads(edges: readonly Edge[], color: string, alpha: number): void {
    const count = edges.length >= 6 ? 3 : Math.min(edges.length, 2);
    const hl = tokens.arrow.headLength * k;
    const hw = tokens.arrow.headWidth * k;
    for (let i = 0; i < count; i += 1) {
      const e = edges[Math.floor(((2 * i + 1) * edges.length) / (2 * count))] as Edge;
      const [a, b] = seg(e);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const c = center(e.hex);
      const l = Math.hypot(m.x - c.x, m.y - c.y);
      if (l === 0) continue;
      const ux = (m.x - c.x) / l;
      const uy = (m.y - c.y) / l;
      const tip = { x: m.x + ux * hl * 0.5, y: m.y + uy * hl * 0.5 };
      const bx = tip.x - ux * hl;
      const by = tip.y - uy * hl;
      g.poly([
        tip.x,
        tip.y,
        bx - uy * (hw / 2),
        by + ux * (hw / 2),
        bx + uy * (hw / 2),
        by - ux * (hw / 2),
      ]);
      g.fill({ color, alpha });
    }
  }

  // Самый трудный из ближайших боёв: отряды армии рядом с занятыми врагом гексами зоны.
  function worstForecast(v: PlayerView, p: FrontPlan): ForecastOutcome | null {
    const zone = new Set(p.zone);
    let worst: ForecastOutcome | null = null;
    for (const u of v.units) {
      if (u.armyId !== p.armyId || u.type === 'artillery') continue;
      for (const n of neighbors(hexFromId(u.hex, map.width))) {
        if (!inBounds(n, map.width, map.height)) continue;
        const id = hexId(n, map.width);
        if (!zone.has(id) || !isHostile(v, id)) continue;
        const f = forecastBattle(map, v, [u.id], id).outcome;
        if (worst === null || RANK[f] < RANK[worst]) worst = f;
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

  function drawOffensiveLine(
    front: readonly number[],
    line: readonly number[],
    color: string,
    alpha: number,
  ) {
    const edges = offensiveEdges(map, front, line);
    const segs = edges.map(seg);
    strokeSegs(segs, color, arrowW(), alpha);
    drawHeads(edges, color, alpha);
    return segs;
  }

  function drawOffensive(v: PlayerView, p: FrontPlan, color: string): void {
    const line = p.offensive;
    if (!line) return;
    for (const h of p.zone)
      g.poly(hexPolygon(center(h), radius)).fill({ color, alpha: ZONE_ALPHA });
    const segs = drawOffensiveLine(p.hexes, line, color, tokens.arrow.alpha);
    active.push({ segs, width: arrowW() * FLOW_SHARE });
    const worst = worstForecast(v, p);
    const mid = segs[Math.floor(segs.length / 2)];
    if (worst && mid) {
      const tone =
        worst === 'victory'
          ? tokens.status.success
          : worst === 'defeat'
            ? tokens.status.danger
            : tokens.ui.ink;
      label(t(`forecast.${worst}` as MessageKey), tone, mid[0]);
    }
  }

  function drawDraft(v: PlayerView, d: Draft, color: string): void {
    const plan = v.plans.find((p) => p.armyId === d.armyId);
    const front = plan?.kind === 'front' ? plan.hexes : [];
    const path = draftPath({ map, view: v, radius, front }, d);
    if (d.mode === 'front') drawFrontEdges(v, path, color, DRAFT_ALPHA);
    else if (d.mode === 'line') drawDefense(v, path, color, DRAFT_ALPHA);
    else drawOffensiveLine(front, path, color, DRAFT_ALPHA);
  }

  return {
    container,
    setView(v, draft, scale, lvl) {
      k = 1 / scale;
      level = lvl;
      g.clear();
      for (const tx of labels.removeChildren()) tx.destroy();
      active = [];
      const colorOf = (armyId: number): string | null => {
        const army = v.armies.find((a) => a.id === armyId);
        return army ? armyColor(v.playerId, army.number) : null;
      };
      for (const p of v.plans) {
        const color = colorOf(p.armyId);
        if (!color) continue;
        if (p.kind === 'line') {
          drawDefense(v, p.hexes, color);
          continue;
        }
        drawOffensive(v, p, color);
        drawFrontEdges(v, p.hexes, color);
      }
      const dc = draft ? colorOf(draft.armyId) : null;
      if (draft && dc) drawDraft(v, draft, dc);
    },
    frame(nowMs) {
      flow.clear();
      const phase = ((nowMs / 1000) * FLOW_SPEED) % (FLOW_DASH + FLOW_GAP);
      for (const a of active) {
        for (const s of a.segs) dashedPath(flow, s, FLOW_DASH * k, FLOW_GAP * k, phase * k);
        flow.stroke({ color: tokens.ui.surface, width: a.width, cap: 'round' });
      }
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
