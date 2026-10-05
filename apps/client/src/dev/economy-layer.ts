// Слой песочницы /dev/sandbox (02/T10–T11, 03/T12): территории, дороги пунктиром, города, стройки,
// отряды и бои, выбранный гекс. Дороги лежат под узорами рельефа, города, стройки и отряды — над ними
// (style-guide, слои).
import { Container, Graphics } from 'pixi.js';

import {
  LINK,
  hexFromId,
  hexId,
  inBounds,
  neighbor,
  neighbors,
  type MapStatic,
  type PlayerView,
  type Direction,
} from '@hexfront/sim';

import { captureProgress, cityFlashAlpha } from './battle-visuals.ts';
import { cityLabelsKey, citySize, drawCities, drawCityLabels } from './city-glyphs.ts';
import { drawForecastPlate, type ForecastBadge } from './forecast-plate.ts';
import type { Draft } from './plan-draft.ts';
import { createPlanLayer } from './plan-layer.ts';
import type { SplitOverlay } from './split-drag.ts';
import { createUnitLayer } from './unit-layer.ts';
import type { DetailLevel } from '../render/camera.ts';
import { hexCenter, hexEdge, hexPolygon, type Point } from '../render/hex-geometry.ts';
import { playerFill, playerLine } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Толщина выделения гекса и дуги стройки, экранные px (токена нет — отладочный вид). */
const MARK_WIDTH_PX = 2.5;
/** Плашка прогноза над центром целевого гекса — выше его фишки, px экрана. */
const PLATE_LIFT_PX = 30;
/** Радиус дуги стройки — доля радиуса гекса. */
const ARC_RADIUS = 0.78;

/** Что выбрано на странице: гекс, свои отряды и цель атаки, ждущая подтверждения. */
export interface SandboxSelection {
  readonly hex: number | null;
  readonly units: readonly number[];
  readonly target: number | null;
}

const NOTHING: SandboxSelection = { hex: null, units: [], target: null };

export interface EconomyLayer {
  readonly container: Container;
  readonly top: Container;
  update(scale: number, level: DetailLevel): void;
  setView(view: PlayerView, selected: SandboxSelection): void;
  /** Рисуемый план армии (режим рисования) или null. */
  setDraft(draft: Draft | null): void;
  /** Выбранная армия: у её фронта — ручки на концах. */
  setSelectedArmy(id: number | null): void;
  setPlanHover(world: Point | null): void;
  /** Подсветка пути перестройки снабжения из карточки города. */
  setRoadPreview(path: readonly number[] | null): void;
  /** Кольцо «сколько взять» при вытягивании части из фишки. */
  setSplit(o: SplitOverlay | null): void;
  /**
   * Цель приказа, пока палец держит (или мышь наводит): подсветка гекса и плашка прогноза над
   * ним, если там враг; null — убрать.
   */
  setOrderTarget(t: OrderTarget | null): void;
  chipAt(hex: number): Point;
  frame(nowMs: number): void;
  destroy(): void;
}

/** Цель приказа удержанием или наведением: гекс и плашка прогноза (null — не враг). */
export interface OrderTarget {
  readonly hex: number;
  readonly badge: ForecastBadge | null;
}

/** Пунктир отрезка: штрих и промежуток — в мировых единицах. */
function dashed(g: Graphics, a: Point, b: Point, dash: number, gap: number, offset = 0): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const period = dash + gap;
  const start = -((offset % period) + period) % period;
  for (let t = start; t < len; t += period) {
    const e = Math.min(len, t + dash);
    const from = Math.max(0, t);
    if (e <= from) continue;
    g.moveTo(a.x + ux * from, a.y + uy * from).lineTo(a.x + ux * e, a.y + uy * e);
  }
}

/** Возвращает фазу пунктира дороги; один пиксель в секунду сохраняет читаемость карты. */
export function constructionDashOffset(nowMs: number, dash: number, gap: number): number {
  const period = dash + gap;
  return period === 0 ? 0 : Math.floor(nowMs / 1000) % period;
}

/** Проверяет, нужно ли двигать «муравьёв» незавершённой дороги. */
export function shouldAnimateRoadConstruction(reducedMotion: boolean): boolean {
  return !reducedMotion;
}

/**
 * Рёбра дорог — дерево обхода в ширину по узлам (дорога или город) любых владельцев: дорога —
 * свойство гекса и на границах не рвётся (style-guide, «Дороги»). Все пары соседей дали бы
 * треугольники там, где три дорожных гекса стоят вплотную.
 */
export function roadTree(map: MapStatic, view: PlayerView): [number, number][] {
  const cityHexes = new Set(view.cities.map((c) => c.hex));
  const isNode = (id: number): boolean => view.hexes.road[id] === 1 || cityHexes.has(id);
  const seen = new Uint8Array(view.hexes.owner.length);
  const edges: [number, number][] = [];
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] === 1 || !isNode(start)) continue;
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const id = queue.shift() as number;
      for (const n of neighbors(hexFromId(id, map.width))) {
        if (!inBounds(n, map.width, map.height)) continue;
        const nid = hexId(n, map.width);
        if (seen[nid] === 1 || !isNode(nid)) continue;
        seen[nid] = 1;
        edges.push([id, nid]);
        queue.push(nid);
      }
    }
  }
  return edges;
}

/**
 * Чей цвет у отрезка дороги: владельца — если оба гекса его и в основной сети (отрезок проводит
 * снабжение); иначе null — серый пунктир (нейтральная дорога, граница, изоляция).
 */
export function roadEdgeOwner(view: PlayerView, a: number, b: number): number | null {
  const owner = view.hexes.owner[a] ?? -1;
  if (owner < 0 || view.hexes.owner[b] !== owner) return null;
  const main = view.hexes.link[a] === LINK.main && view.hexes.link[b] === LINK.main;
  return main ? owner : null;
}

export interface TerritoryBorder {
  readonly hex: number;
  readonly direction: number;
  readonly owner: number;
  readonly neighborOwner: number;
}

/** Возвращает кромки территории; общая граница выдаётся с обеих сторон. */
export function territoryBorders(map: MapStatic, view: PlayerView): TerritoryBorder[] {
  const borders: TerritoryBorder[] = [];
  for (let id = 0; id < view.hexes.owner.length; id += 1) {
    const owner = view.hexes.owner[id] ?? -1;
    if (owner < 0) continue;
    for (const direction of [0, 1, 2, 3, 4, 5] as const satisfies readonly Direction[]) {
      const adjacent = neighbor(hexFromId(id, map.width), direction);
      const neighborOwner = inBounds(adjacent, map.width, map.height)
        ? (view.hexes.owner[hexId(adjacent, map.width)] ?? -1)
        : -1;
      if (neighborOwner !== owner) borders.push({ hex: id, direction, owner, neighborOwner });
    }
  }
  return borders;
}

/** Возвращает гексы вне зоны обзора, где рисуется штриховка без затемнения. */
export function fogHexes(view: PlayerView): number[] {
  return Array.from(view.hexes.visible, (visible, id) => (visible === 0 ? id : -1)).filter(
    (id) => id >= 0,
  );
}

/** Создаёт слой; данные приходят снимками playerView 10 раз в секунду. */
export function createEconomyLayer(map: MapStatic, radius: number): EconomyLayer {
  const fill = new Graphics();
  const captures = new Graphics();
  const constructionEffects = new Graphics();
  const cityEffects = new Graphics();
  const roads = new Graphics();
  const roadPreview = new Graphics();
  const borders = new Graphics();
  const fog = new Graphics();
  const marks = new Graphics();
  const labels = new Container();

  const container = new Container();
  container.addChild(fill, captures, roads, roadPreview, constructionEffects, cityEffects);
  const top = new Container();
  const center = (id: number): Point => hexCenter(hexFromId(id, map.width), radius);
  const unitLayer = createUnitLayer(map.width, radius, center);
  const planLayer = createPlanLayer(map, radius, center);
  // Плашка прогноза — поверх фишек.
  const plates = new Container();
  top.addChild(borders, fog, planLayer.container, marks, labels, unitLayer.container, plates);
  let view: PlayerView | null = null;
  let selected: SandboxSelection = NOTHING;
  let draft: Draft | null = null;
  let selectedArmy: number | null = null;
  let roadPreviewPath: readonly number[] | null = null;
  let split: SplitOverlay | null = null;
  let orderTarget: OrderTarget | null = null;
  let scale = 1;
  let level: DetailLevel = 2;
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frameMs = 0;
  let previousOwners: Int16Array | null = null;
  const capturesByHex = new Map<number, { readonly started: number; readonly color: string }>();
  const cityFlashes = new Map<number, { readonly started: number; readonly color: string }>();
  let labelsKey = '';

  function rememberEffects(v: PlayerView, nowMs: number): void {
    if (previousOwners) {
      for (let id = 0; id < v.hexes.owner.length; id += 1) {
        const before = previousOwners[id] ?? -1;
        const after = v.hexes.owner[id] ?? -1;
        if (before !== after && after >= 0) {
          capturesByHex.set(id, { started: nowMs, color: playerLine(after) });
        }
      }
    }
    const oldCities = new Map<number, number>();
    if (view) for (const city of view.cities) oldCities.set(city.id, city.owner);
    for (const city of v.cities) {
      if (oldCities.get(city.id) !== undefined && oldCities.get(city.id) !== city.owner) {
        cityFlashes.set(city.id, { started: nowMs, color: playerLine(city.owner) });
      }
    }
    previousOwners = v.hexes.owner.slice();
  }

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

  function drawCaptureEffects(): void {
    captures.clear();
    for (const [id, effect] of capturesByHex) {
      const progress = captureProgress(frameMs - effect.started, reducedMotion);
      if (progress >= 1) {
        capturesByHex.delete(id);
        continue;
      }
      const point = center(id);
      const polygon = hexPolygon(point, radius * progress);
      captures.poly(polygon).fill({ color: effect.color, alpha: 1 });
    }
  }

  function drawConstructionEffects(v: PlayerView): void {
    constructionEffects.clear();
    const k = 1 / scale;
    for (const c of v.constructions) {
      const p = center(c.hex);
      if (c.kind === 'road') {
        const [dash, gap] = tokens.road.dash;
        const pts = c.path.map(center);
        const offset = shouldAnimateRoadConstruction(reducedMotion)
          ? constructionDashOffset(frameMs, dash, gap)
          : 0;
        for (let i = 1; i < pts.length; i += 1) {
          dashed(
            constructionEffects,
            pts[i - 1] as Point,
            pts[i] as Point,
            dash * k,
            gap * k,
            offset * k,
          );
        }
        constructionEffects.stroke({
          color: playerLine(c.owner),
          alpha: tokens.road.isolatedAlpha,
          width: MARK_WIDTH_PX * k,
        });
      } else {
        const share = c.totalTicks > 0 ? c.progressTicks / c.totalTicks : 0;
        constructionEffects
          .arc(p.x, p.y, radius * ARC_RADIUS, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2)
          .stroke({ color: playerLine(c.owner), width: MARK_WIDTH_PX * k, cap: 'round' });
      }
    }
  }

  function drawCityFlashEffects(v: PlayerView): void {
    cityEffects.clear();
    for (const [id, effect] of cityFlashes) {
      const city = v.cities.find((item) => item.id === id);
      if (!city) {
        cityFlashes.delete(id);
        continue;
      }
      const elapsed = frameMs - effect.started;
      if (elapsed >= tokens.motion.capture) {
        cityFlashes.delete(id);
        continue;
      }
      cityEffects
        .circle(center(city.hex).x, center(city.hex).y, citySize(radius, city.level))
        .fill({ color: effect.color, alpha: cityFlashAlpha(elapsed, reducedMotion) });
    }
  }

  function drawRoads(v: PlayerView): void {
    roads.clear();
    const width = (tokens.road.width[level - 1] ?? tokens.road.width[1]) / scale;
    const [dash, gap] = tokens.road.dash;
    for (const [a, b] of roadTree(map, v)) {
      const owner = roadEdgeOwner(v, a, b);
      dashed(roads, center(a), center(b), dash / scale, gap / scale);
      roads.stroke({
        color: owner === null ? tokens.neutral.road : playerLine(owner),
        alpha: owner === null ? tokens.road.isolatedAlpha : 1,
        width,
        cap: 'round',
      });
    }
  }

  function drawRoadPreview(v: PlayerView): void {
    roadPreview.clear();
    if (!roadPreviewPath || roadPreviewPath.length < 2) return;
    const k = 1 / scale;
    const [dash, gap] = tokens.road.dash;
    for (let i = 1; i < roadPreviewPath.length; i += 1) {
      const from = center(roadPreviewPath[i - 1] as number);
      const to = center(roadPreviewPath[i] as number);
      dashed(roadPreview, from, to, dash * k, gap * k);
    }
    roadPreview.stroke({
      color: playerLine(v.playerId),
      alpha: tokens.road.isolatedAlpha,
      width: MARK_WIDTH_PX * k,
      cap: 'round',
    });
  }

  function drawBorders(v: PlayerView): void {
    borders.clear();
    const width =
      (tokens.territory.borderWidth[level - 1] ?? tokens.territory.borderWidth[1]) / scale;
    const byOwner = new Map<number, TerritoryBorder[]>();
    for (const edge of territoryBorders(map, v)) {
      const list = byOwner.get(edge.owner) ?? [];
      list.push(edge);
      byOwner.set(edge.owner, list);
    }
    for (const [owner, edges] of byOwner) {
      for (const edge of edges) {
        const centerPoint = center(edge.hex);
        const [a, b] = hexEdge(centerPoint, radius - width / 2, edge.direction);
        borders.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      borders.stroke({ color: playerLine(owner), width, cap: 'round' });
    }
  }

  function drawFog(v: PlayerView): void {
    fog.clear();
    const spacing = tokens.fog.hatchSpacing / scale;
    const hatchRadius = radius * 0.68;
    for (const id of fogHexes(v)) {
      const point = center(id);
      for (let offset = -hatchRadius; offset <= hatchRadius; offset += spacing) {
        fog
          .moveTo(point.x - hatchRadius, point.y + offset + hatchRadius * 0.35)
          .lineTo(point.x + hatchRadius, point.y + offset - hatchRadius * 0.35);
      }
    }
    fog.stroke({
      color: tokens.fog.hatch,
      alpha: tokens.fog.hatchAlpha,
      width: tokens.fog.hatchWidth / scale,
      pixelLine: true,
    });
  }

  function drawMarks(v: PlayerView): void {
    marks.clear();
    const k = 1 / scale;
    const glyphs = v.cities.map((c) => ({
      at: center(c.hex),
      level: c.level,
      color: c.owner < 0 ? tokens.neutral.line : playerLine(c.owner),
      isCapital: c.isCapital,
      isolated: c.isolated,
    }));
    drawCities(marks, glyphs, k, radius);
    const nextLabelsKey = cityLabelsKey(
      v.cities.map((c) => ({
        at: center(c.hex),
        name: c.name,
        level: c.level,
        isCapital: c.isCapital,
      })),
      scale,
      level,
    );
    if (nextLabelsKey !== labelsKey) {
      labelsKey = nextLabelsKey;
      labels.removeChildren().forEach((child) => child.destroy());
      drawCityLabels(
        labels,
        v.cities.map((c) => ({
          at: center(c.hex),
          name: c.name,
          level: c.level,
          isCapital: c.isCapital,
        })),
        scale,
        level,
        radius,
      );
    }
    if (selected.hex !== null) {
      marks
        .poly(hexPolygon(center(selected.hex), radius))
        .stroke({ color: tokens.ui.ink, width: MARK_WIDTH_PX * k });
    }
    if (selected.target !== null) {
      marks
        .poly(hexPolygon(center(selected.target), radius))
        .stroke({ color: tokens.status.danger, width: MARK_WIDTH_PX * k });
    }
    for (const p of plates.removeChildren()) p.destroy({ children: true });
    if (orderTarget) {
      const at = center(orderTarget.hex);
      marks.poly(hexPolygon(at, radius)).stroke({
        color: orderTarget.badge ? tokens.status.danger : tokens.ui.ink,
        width: MARK_WIDTH_PX * k,
      });
      // Над целевым гексом, выше фишек (art/units.md, «Плашка прогноза»).
      if (orderTarget.badge) drawForecastPlate(plates, orderTarget.badge, at, k, PLATE_LIFT_PX);
    }
  }

  const redraw = (): void => {
    if (!view) return;
    drawFill(view);
    drawRoads(view);
    drawRoadPreview(view);
    drawBorders(view);
    drawFog(view);
    drawMarks(view);
    drawConstructionEffects(view);
    drawCaptureEffects();
    drawCityFlashEffects(view);
    planLayer.setView(view, draft, selectedArmy, split, scale, level);
  };

  return {
    container,
    top,
    update(s, l) {
      scale = s;
      level = l;
      unitLayer.setScale(s);
      redraw();
    },
    setView(v, sel) {
      rememberEffects(v, performance.now());
      view = v;
      selected = sel;
      redraw();
      unitLayer.setView(v, sel, performance.now());
    },
    setSplit(o) {
      split = o;
      redraw();
    },
    setOrderTarget(t) {
      orderTarget = t;
      redraw();
    },
    chipAt(hex) {
      return unitLayer.chipAt(hex);
    },
    setSelectedArmy(id) {
      selectedArmy = id;
      redraw();
    },
    setPlanHover(world) {
      planLayer.setHover(world);
    },
    setRoadPreview(path) {
      roadPreviewPath = path;
      redraw();
    },
    setDraft(d) {
      draft = d;
      redraw();
    },
    frame(nowMs) {
      const changed = frameMs !== nowMs;
      frameMs = nowMs;
      if (changed && shouldAnimateRoadConstruction(reducedMotion)) {
        if (view?.constructions.some((c) => c.kind === 'road')) drawConstructionEffects(view);
      }
      if (changed && view && (capturesByHex.size > 0 || cityFlashes.size > 0)) {
        drawCaptureEffects();
        drawCityFlashEffects(view);
      }
      unitLayer.frame(nowMs);
      planLayer.frame(nowMs);
    },
    destroy() {
      container.destroy({ children: true });
      top.destroy({ children: true });
    },
  };
}
