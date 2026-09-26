// Планы армий на карте (CR-002, style-guide «Армии, фронты и линии», units.md «Линия наступления»):
// линия фронта по рёбрам с врагом, линия обороны с зубцами к врагу, линия наступления с
// наконечниками и зоной, прогноз у линии, черновик рисуемого плана. Всё — в цвете армии.
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
import { isHostile } from './sandbox-selection.ts';
import { dashedPath } from './unit-layer.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import type { DetailLevel } from '../render/camera.ts';
import { hexEdge, hexPolygon, type Point } from '../render/hex-geometry.ts';
import { armyColor } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Заливка зоны наступления — 12 % цвета армии (units.md, «Линия наступления»). */
const ZONE_ALPHA = 0.12;
/** Бегущий пунктир по активной линии: доля ширины линии, штрих/промежуток и скорость, px экрана. */
const FLOW_SHARE = 0.3;
const FLOW_DASH = 10;
const FLOW_GAP = 14;
const FLOW_SPEED = 20;
/** Черновик: линия и точки, px экрана (отладочный вид режима рисования). */
const DRAFT_PX = 3;
const DRAFT_DOT = 5;
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

interface Pt {
  x: number;
  y: number;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: Pt): number => Math.hypot(a.x, a.y);

function polyline(g: Graphics, pts: readonly Point[]): void {
  const [first, ...rest] = pts;
  if (!first) return;
  g.moveTo(first.x, first.y);
  for (const p of rest) g.lineTo(p.x, p.y);
}

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
  let active: { pts: Point[]; width: number }[] = [];

  const around = (hex: number): { d: number; id: number }[] =>
    neighbors(hexFromId(hex, map.width)).flatMap((n, d) =>
      inBounds(n, map.width, map.height) ? [{ d, id: hexId(n, map.width) }] : [],
    );

  function drawFront(v: PlayerView, p: PlanView & { kind: 'front' }, color: string, w: number) {
    for (const h of p.hexes) {
      for (const { d, id } of around(h)) {
        if (v.hexes.owner[id] !== p.enemyId) continue;
        const [a, b] = hexEdge(center(h), radius, d);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
    }
    g.stroke({
      color: tokens.front.casing,
      width: w + 2 * tokens.front.casingWidth * k,
      cap: 'round',
    });
    for (const h of p.hexes) {
      for (const { d, id } of around(h)) {
        if (v.hexes.owner[id] !== p.enemyId) continue;
        const [a, b] = hexEdge(center(h), radius, d);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
    }
    g.stroke({ color, width: w, cap: 'round' });
  }

  // Зубцы — к «центру тяжести» чужой земли: с какой стороны линии враг.
  function drawDefense(v: PlayerView, hexes: readonly number[], color: string, w: number): void {
    const pts = hexes.map(center);
    if (pts.length === 0) return;
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
    polyline(g, pts);
    g.stroke({
      color: tokens.front.casing,
      width: w + 2 * tokens.front.casingWidth * k,
      cap: 'round',
      join: 'round',
    });
    polyline(g, pts);
    if (pts.length === 1) g.circle((pts[0] as Point).x, (pts[0] as Point).y, w);
    g.stroke({ color, width: w, cap: 'round', join: 'round' });
    const { length, spacing } = tokens.armies.defenseTeeth;
    const enemy = n > 0 ? { x: ex / n, y: ey / n } : null;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1] as Point;
      const b = pts[i] as Point;
      const seg = sub(b, a);
      const l = len(seg);
      if (l === 0) continue;
      let nx = -seg.y / l;
      let ny = seg.x / l;
      if (enemy && (enemy.x - a.x) * nx + (enemy.y - a.y) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      const tl = length * k + w / 2;
      for (let s = (spacing * k) / 2; s < l; s += spacing * k) {
        const x = a.x + (seg.x * s) / l;
        const y = a.y + (seg.y * s) / l;
        g.moveTo(x, y).lineTo(x + nx * tl, y + ny * tl);
      }
    }
    g.stroke({ color, width: Math.max(1, w / 2), cap: 'round' });
  }

  function drawHeads(
    front: readonly number[],
    line: readonly number[],
    color: string,
    gap: number,
  ): void {
    const count = line.length >= 6 ? 3 : line.length >= 2 ? 2 : 1;
    const fronts = front.map(center);
    if (fronts.length === 0) return;
    const hl = tokens.arrow.headLength * k;
    const hw = tokens.arrow.headWidth * k;
    for (let i = 0; i < count; i += 1) {
      const at = center(line[Math.floor(((2 * i + 1) * line.length) / (2 * count))] as number);
      let from = fronts[0] as Point;
      for (const f of fronts) if (len(sub(at, f)) < len(sub(at, from))) from = f;
      const dir = sub(at, from);
      const l = len(dir);
      if (l === 0) continue;
      const ux = dir.x / l;
      const uy = dir.y / l;
      // Наконечник перед линией, остриём в неё: под толстой линией он бы терялся.
      const tx = at.x - ux * gap;
      const ty = at.y - uy * gap;
      const bx = tx - ux * hl;
      const by = ty - uy * hl;
      g.poly([
        tx,
        ty,
        bx - uy * (hw / 2),
        by + ux * (hw / 2),
        bx + uy * (hw / 2),
        by - ux * (hw / 2),
      ]).fill({
        color,
        alpha: tokens.arrow.alpha,
      });
    }
  }

  // Самый трудный из ближайших боёв: отряды армии рядом с занятыми врагом гексами зоны.
  function worstForecast(v: PlayerView, p: PlanView & { kind: 'front' }): ForecastOutcome | null {
    const zone = new Set(p.zone);
    let worst: ForecastOutcome | null = null;
    for (const u of v.units) {
      if (u.armyId !== p.armyId || u.type === 'artillery') continue;
      for (const { id } of around(u.hex)) {
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

  function drawOffensive(
    v: PlayerView,
    p: PlanView & { kind: 'front' },
    color: string,
    level: DetailLevel,
  ): void {
    const line = p.offensive;
    if (!line) return;
    for (const h of p.zone)
      g.poly(hexPolygon(center(h), radius)).fill({ color, alpha: ZONE_ALPHA });
    const w = (tokens.arrow.width[level - 1] ?? tokens.arrow.width[1]) * k;
    const pts = line.map(center);
    polyline(g, pts);
    g.stroke({ color, alpha: tokens.arrow.alpha, width: w, cap: 'round', join: 'round' });
    drawHeads(p.hexes, line, color, w / 2);
    active.push({ pts, width: w * FLOW_SHARE });
    const worst = worstForecast(v, p);
    const mid = pts[Math.floor(pts.length / 2)];
    if (worst && mid) {
      const tone =
        worst === 'victory'
          ? tokens.status.success
          : worst === 'defeat'
            ? tokens.status.danger
            : tokens.ui.ink;
      label(t(`forecast.${worst}` as MessageKey), tone, mid);
    }
  }

  function drawDraft(v: PlayerView, d: Draft): void {
    const pts = draftPath(map, v, d).map(center);
    polyline(g, pts);
    g.stroke({ color: tokens.ui.ink, width: DRAFT_PX * k, cap: 'round', join: 'round' });
    for (const h of d.points) {
      const c = center(h);
      g.circle(c.x, c.y, DRAFT_DOT * k)
        .fill(tokens.ui.surface)
        .stroke({ color: tokens.ui.ink, width: 2 * k });
    }
  }

  return {
    container,
    setView(v, draft, scale, level) {
      k = 1 / scale;
      g.clear();
      for (const tx of labels.removeChildren()) tx.destroy();
      active = [];
      const w = (tokens.front.width[level - 1] ?? tokens.front.width[1]) * k;
      for (const p of v.plans) {
        const army = v.armies.find((a) => a.id === p.armyId);
        if (!army) continue;
        const color = armyColor(v.playerId, army.number);
        if (p.kind === 'line') {
          drawDefense(v, p.hexes, color, w);
          continue;
        }
        drawOffensive(v, p, color, level);
        drawFront(v, p, color, w);
      }
      if (draft) drawDraft(v, draft);
    },
    frame(nowMs) {
      flow.clear();
      const phase = ((nowMs / 1000) * FLOW_SPEED) % (FLOW_DASH + FLOW_GAP);
      for (const a of active) {
        dashedPath(flow, a.pts, FLOW_DASH * k, FLOW_GAP * k, phase * k);
        flow.stroke({ color: tokens.ui.surface, width: a.width, cap: 'round' });
      }
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
