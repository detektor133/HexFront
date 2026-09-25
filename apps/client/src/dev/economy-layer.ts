// Слой экономики для /dev/economy (02/T10–T11): территории, дороги пунктиром, города, стройки,
// выбранный гекс. Дороги лежат под узорами рельефа, города и стройки — над ними (style-guide, слои).
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

import { drawCities } from './city-glyphs.ts';
import type { DetailLevel } from '../render/camera.ts';
import { hexCenter, hexPolygon, type Point } from '../render/hex-geometry.ts';
import { playerFill, playerLine } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Толщина выделения гекса и дуги стройки, экранные px (токена нет — отладочный вид). */
const MARK_WIDTH_PX = 2.5;
/** Радиус дуги стройки — доля радиуса гекса. */
const ARC_RADIUS = 0.78;

export interface EconomyLayer {
  readonly container: Container;
  readonly top: Container;
  update(scale: number, level: DetailLevel): void;
  setView(view: PlayerView, selected: number | null): void;
  destroy(): void;
}

/** Пунктир отрезка: штрих и промежуток — в мировых единицах. */
function dashed(g: Graphics, a: Point, b: Point, dash: number, gap: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  for (let t = 0; t < len; t += dash + gap) {
    const e = Math.min(len, t + dash);
    g.moveTo(a.x + ux * t, a.y + uy * t).lineTo(a.x + ux * e, a.y + uy * e);
  }
}

/**
 * Рёбра дорог — дерево обхода в ширину по узлам одного владельца (дорога или город).
 * Все пары соседей дали бы треугольники там, где три дорожных гекса стоят вплотную.
 */
export function roadTree(map: MapStatic, view: PlayerView): [number, number][] {
  const cityHexes = new Set(view.cities.map((c) => c.hex));
  const isNode = (id: number): boolean => view.hexes.road[id] === 1 || cityHexes.has(id);
  const seen = new Uint8Array(view.hexes.owner.length);
  const edges: [number, number][] = [];
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] === 1 || !isNode(start)) continue;
    const owner = view.hexes.owner[start];
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const id = queue.shift() as number;
      for (const n of neighbors(hexFromId(id, map.width))) {
        if (!inBounds(n, map.width, map.height)) continue;
        const nid = hexId(n, map.width);
        if (seen[nid] === 1 || !isNode(nid) || view.hexes.owner[nid] !== owner) continue;
        seen[nid] = 1;
        edges.push([id, nid]);
        queue.push(nid);
      }
    }
  }
  return edges;
}

/** Создаёт слой; данные приходят снимками playerView 10 раз в секунду. */
export function createEconomyLayer(map: MapStatic, radius: number): EconomyLayer {
  const fill = new Graphics();
  const roads = new Graphics();
  const marks = new Graphics();
  const container = new Container();
  container.addChild(fill, roads);
  const top = new Container();
  top.addChild(marks);
  let view: PlayerView | null = null;
  let selected: number | null = null;
  let scale = 1;
  let level: DetailLevel = 2;
  const center = (id: number): Point => hexCenter(hexFromId(id, map.width), radius);

  function drawFill(v: PlayerView): void {
    fill.clear();
    v.hexes.owner.forEach((owner, id) => {
      if (owner < 0) return;
      fill.poly(hexPolygon(center(id), radius)).fill({
        color: playerFill(owner),
        alpha: owner === v.playerId ? tokens.territory.alphaOwn : tokens.territory.alphaOther,
      });
    });
  }

  function drawRoads(v: PlayerView): void {
    roads.clear();
    const width = (tokens.road.width[level - 1] ?? tokens.road.width[1]) / scale;
    const [dash, gap] = tokens.road.dash;
    for (const [a, b] of roadTree(map, v)) {
      const owner = v.hexes.owner[a] ?? -1;
      const isolated = v.hexes.link[a] === LINK.isolated || v.hexes.link[b] === LINK.isolated;
      dashed(roads, center(a), center(b), dash / scale, gap / scale);
      roads.stroke({
        color: owner < 0 || isolated ? tokens.neutral.road : playerLine(owner),
        alpha: isolated ? tokens.road.isolatedAlpha : 1,
        width,
        cap: 'round',
      });
    }
  }

  function drawMarks(v: PlayerView): void {
    marks.clear();
    const k = 1 / scale;
    for (const c of v.constructions) {
      const p = center(c.hex);
      if (c.kind === 'road') {
        const [dash, gap] = tokens.road.dash;
        const pts = c.path.map(center);
        for (let i = 1; i < pts.length; i += 1) {
          dashed(marks, pts[i - 1] as Point, pts[i] as Point, dash * k, gap * k);
        }
        marks.stroke({
          color: playerLine(c.owner),
          alpha: tokens.road.isolatedAlpha,
          width: MARK_WIDTH_PX * k,
        });
        continue;
      }
      const share = c.totalTicks > 0 ? c.progressTicks / c.totalTicks : 0;
      const start = -Math.PI / 2;
      marks
        .arc(p.x, p.y, radius * ARC_RADIUS, start, start + share * Math.PI * 2)
        .stroke({ color: playerLine(c.owner), width: MARK_WIDTH_PX * k, cap: 'round' });
    }
    const glyphs = v.cities.map((c) => ({
      at: center(c.hex),
      level: c.level,
      color: c.owner < 0 ? tokens.neutral.line : playerLine(c.owner),
      isCapital: c.isCapital,
      isolated: c.isolated,
    }));
    drawCities(marks, glyphs, k, radius);
    if (selected !== null) {
      marks
        .poly(hexPolygon(center(selected), radius))
        .stroke({ color: tokens.ui.ink, width: MARK_WIDTH_PX * k });
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
    top,
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
      top.destroy({ children: true });
    },
  };
}
