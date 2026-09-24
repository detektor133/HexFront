// Только для /dev/economy: временный отладочный вид экономики (этап 02/T10), не финальный стиль.
// Территории, города кругами, дороги линиями (изолированные — пунктиром), стройки, выбранный гекс.
import { Container, Graphics } from 'pixi.js';

import {
  LINK,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import type { DetailLevel } from '../render/camera.ts';
import { hexCenter, hexPolygon, type Point } from '../render/hex-geometry.ts';
import { playerFill, playerLine } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Толщина отладочных пометок (стройки, выбор), экранные px: временный вид, токена нет. */
const MARK_WIDTH_PX = 2;
/** Кольцо стройки на гексе — доля радиуса гекса. */
const SITE_RING = 0.5;

export interface EconomyLayer {
  readonly container: Container;
  update(scale: number, level: DetailLevel): void;
  setView(view: PlayerView, selected: number | null): void;
  destroy(): void;
}

/** Пунктир отрезка: штрих и промежуток — в мировых единицах. */
function dashed(g: Graphics, a: Point, b: Point, dash: number, gap: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  for (let t = 0; t < len; t += dash + gap) {
    const e = Math.min(len, t + dash);
    g.moveTo(a.x + ux * t, a.y + uy * t).lineTo(a.x + ux * e, a.y + uy * e);
  }
}

/** Создаёт слой; данные приходят снимками playerView 10 раз в секунду. */
export function createEconomyLayer(map: MapStatic, radius: number): EconomyLayer {
  const fill = new Graphics();
  const roads = new Graphics();
  const marks = new Graphics();
  const container = new Container();
  container.addChild(fill, roads, marks);
  let view: PlayerView | null = null;
  let selected: number | null = null;
  let scale = 1;
  let level: DetailLevel = 2;
  const center = (id: number): Point => hexCenter(hexFromId(id, map.width), radius);

  function drawFill(v: PlayerView): void {
    fill.clear();
    v.hexes.owner.forEach((owner, id) => {
      if (owner < 0) return;
      const own = owner === v.playerId;
      fill.poly(hexPolygon(center(id), radius)).fill({
        color: playerFill(owner),
        alpha: own ? tokens.territory.alphaOwn : tokens.territory.alphaOther,
      });
    });
  }

  // Дорога — тонкий отрезок между соседними узлами одного владельца (гекс с дорогой или городом),
  // нейтральные дороги карты — тоже. Стиль «метро» не используется (пожелание владельца,
  // CHANGELOG-proposals.md): это временный отладочный вид.
  function drawRoads(v: PlayerView): void {
    roads.clear();
    const cityHexes = new Set(v.cities.map((c) => c.hex));
    const isNode = (id: number): boolean => v.hexes.road[id] === 1 || cityHexes.has(id);
    const width = (tokens.neutral.roadWidth[level - 1] ?? tokens.neutral.roadWidth[1]) / scale;
    const [dash, gap] = tokens.road.isolatedDash;
    for (let id = 0; id < v.hexes.owner.length; id += 1) {
      const owner = v.hexes.owner[id] ?? -1;
      if (!isNode(id)) continue;
      for (const n of neighbors(hexFromId(id, map.width)).slice(0, 3)) {
        if (!inBounds(n, map.width, map.height)) continue;
        const nid = hexId(n, map.width);
        if (v.hexes.owner[nid] !== owner || !isNode(nid)) continue;
        const isolated = v.hexes.link[id] === LINK.isolated;
        if (isolated) dashed(roads, center(id), center(nid), dash / scale, gap / scale);
        else roads.moveTo(center(id).x, center(id).y).lineTo(center(nid).x, center(nid).y);
        roads.stroke({
          color: owner < 0 ? tokens.neutral.road : playerLine(owner),
          width,
          cap: 'round',
          alpha: isolated ? tokens.road.isolatedAlpha : 1,
        });
      }
    }
  }

  function drawMarks(v: PlayerView): void {
    marks.clear();
    const [offDash, offGap] = tokens.road.offroadDotted;
    // Прокладываемая дорога — точечный пунктир по пути.
    for (const c of v.constructions) {
      const pts = c.path.map(center);
      for (let i = 1; i < pts.length; i += 1) {
        dashed(marks, pts[i - 1] as Point, pts[i] as Point, offDash / scale, offGap / scale);
      }
      marks.stroke({ color: playerLine(c.owner), width: MARK_WIDTH_PX / scale, cap: 'round' });
      if (c.kind !== 'road') {
        marks.circle(center(c.hex).x, center(c.hex).y, radius * SITE_RING).stroke({
          color: playerLine(c.owner),
          width: MARK_WIDTH_PX / scale,
          alpha: tokens.road.isolatedAlpha,
        });
      }
    }
    for (const c of v.cities) {
      const r = (tokens.city.radiusByLevel[c.level - 1] ?? tokens.city.radiusByLevel[0]) / scale;
      const w = (tokens.city.strokeByLevel[c.level - 1] ?? tokens.city.strokeByLevel[0]) / scale;
      const p = center(c.hex);
      marks.circle(p.x, p.y, r).fill(tokens.city.fill);
      marks.stroke({ color: c.owner < 0 ? tokens.neutral.line : playerLine(c.owner), width: w });
      if (c.isCapital)
        marks.circle(p.x, p.y, tokens.city.capitalDotRadius / scale).fill(playerLine(c.owner));
      if (c.isolated) {
        marks.circle(p.x, p.y, r + w * 2).stroke({ color: tokens.status.danger, width: w / 2 });
      }
    }
    if (selected !== null) {
      marks
        .poly(hexPolygon(center(selected), radius))
        .stroke({ color: tokens.ui.ink, width: MARK_WIDTH_PX / scale });
    }
  }

  const redraw = (): void => {
    if (!view) return;
    drawFill(view);
    drawRoads(view);
    drawMarks(view);
  };

  return {
    container,
    update(s, l) {
      scale = s;
      level = l;
      redraw();
    },
    setView(v, sel) {
      view = v;
      selected = sel;
      redraw();
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
