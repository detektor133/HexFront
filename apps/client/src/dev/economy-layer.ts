// Слой песочницы /dev/sandbox (02/T10–T11, 03/T12): территории, дороги пунктиром, города, стройки,
// отряды и бои, выбранный гекс. Дороги лежат под узорами рельефа, города, стройки и отряды — над ними
// (style-guide, слои).
import { Container, Graphics, Text } from 'pixi.js';

import type { MarkKind } from '@hexfront/protocol';
import {
  LINK,
  isDepot,
  waterNeighbors,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { battleSides, drawBattlePanel, type MarkerAnchor } from './battle-panel.ts';
import { captureProgress, cityFlashAlpha } from './battle-visuals.ts';
import type {
  EconomyLayerCacheTelemetry,
  FrontTweenCacheTelemetry,
  UnitLayerCacheTelemetry,
} from './cache-telemetry.ts';
import { cityLabelsKey, citySize, drawCities, drawCityLabels } from './city-glyphs.ts';
import { drawConstructions, type ConstructionGlyph } from './construction-glyphs.ts';
import { drawForecastPlate, type ForecastBadge } from './forecast-plate.ts';
import { createMapIconLayer } from './map-icons.ts';
import { createPingLayer } from './ping-layer.ts';
import type { Draft } from './plan-draft.ts';
import { createPlanLayer } from './plan-layer.ts';
import {
  buildTerritoryLabels,
  drawTerritoryLabels,
  territoryLabelsKey,
} from './territory-labels.ts';
import { createUnitLayer, type UnitLayer } from './unit-layer.ts';
import type { DetailLevel } from '../render/camera.ts';
import { hexCenter, hexPolygon, type Point } from '../render/hex-geometry.ts';
import { createMaskGpu, type MaskKind } from '../render/mask-gpu.ts';
import { createTerritoryGpu } from '../render/territory-gpu.ts';
import { playerLine } from '../theme/colors.ts';
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
  readonly territoryLabels: Container;
  update(scale: number, level: DetailLevel): void;
  setView(view: PlayerView, selected: SandboxSelection): void;
  /** Политическая карта: страны красятся по отношению к игроку. */
  setPolitical(on: boolean): void;
  cacheTelemetry(): UnitLayerCacheTelemetry & {
    readonly economy: EconomyLayerCacheTelemetry;
    readonly frontTween: FrontTweenCacheTelemetry;
  };
  /** Рисуемый план армии (режим рисования) или null. */
  setDraft(draft: Draft | null): void;
  /** Выбранная армия: у её фронта — ручки на концах. */
  setSelectedArmy(id: number | null): void;
  setPlanHover(world: Point | null): void;
  /** Подсветка пути перестройки снабжения из карточки города. */
  setRoadPreview(path: readonly number[] | null): void;
  /** Режим карты: маска по гексам (снабжение или стройка) или null — обычная карта. */
  setMapMask(kind: MaskKind | null, mask: Uint8Array | null): void;
  /** Номера точек цепочки приказов Shift+ПКМ на карте (пусто — убрать). */
  setQueueMarks(hexes: readonly number[]): void;
  /** Метка союзника на карте (чат): гекс, вид и игрок, поставивший её. */
  addPing(hex: number, kind: MarkKind, owner: number): void;
  /** Выбранное место старта: постоянный маркер на гексе; null — убрать. */
  setStartMarker(hex: number | null): void;
  /** Подписи на гексах (цена вторжения): текст по центру гекса; пусто — убрать. */
  setHexLabels(labels: readonly { readonly hex: number; readonly text: string }[]): void;
  /**
   * Цель приказа, пока палец держит (или мышь наводит): подсветка гекса и плашка прогноза над
   * ним, если там враг; null — убрать.
   */
  setOrderTarget(t: OrderTarget | null): void;
  /** Подсказка маршрута: путь, время в пути и точки; null — убрать. */
  /** Маркер боя под курсором: панель двух сторон; null — убрать. */
  setBattlePanel(m: MarkerAnchor | null): void;
  battleMarkerAt: UnitLayer['battleMarkerAt'];
  chipAt(hex: number): Point;
  chipBounds: UnitLayer['chipBounds'];
  unitsAt(world: Point): readonly number[];
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

/** Удаляет записи эффектов, которым больше не соответствуют гексы или города снимка. */
export function pruneEconomyLayerCaches<T, U>(
  capturesByHex: Map<number, T>,
  cityFlashes: Map<number, U>,
  hexIds: ReadonlySet<number>,
  cityIds: ReadonlySet<number>,
): void {
  for (const id of capturesByHex.keys()) if (!hexIds.has(id)) capturesByHex.delete(id);
  for (const id of cityFlashes.keys()) if (!cityIds.has(id)) cityFlashes.delete(id);
}

/** Возвращает размеры кэшей эффектов экономики для телеметрии песочницы. */
export function economyLayerCacheTelemetry<T, U>(
  capturesByHex: ReadonlyMap<number, T>,
  cityFlashes: ReadonlyMap<number, U>,
): EconomyLayerCacheTelemetry {
  return { capturesByHex: capturesByHex.size, cityFlashes: cityFlashes.size };
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

/** Создаёт слой; данные приходят снимками playerView 10 раз в секунду. */
export function createEconomyLayer(map: MapStatic, radius: number): EconomyLayer {
  const territory = createTerritoryGpu(map, radius);
  const maskGpu = createMaskGpu(map, radius);
  const constructionEffects = new Graphics();
  const cityEffects = new Graphics();
  const roads = new Graphics();
  const roadPreview = new Graphics();
  const marks = new Graphics();
  marks.context.batchMode = 'batch';
  const labels = new Container();
  const mapIcons = createMapIconLayer();
  const queueMarks = new Container();
  const hexLabels = new Container();

  const container = new Container();
  container.addChild(territory.fill, roads, roadPreview, constructionEffects, cityEffects);
  const top = new Container();
  const center = (id: number): Point => hexCenter(hexFromId(id, map.width), radius);
  const unitLayer = createUnitLayer(map.width, radius, center);
  const planLayer = createPlanLayer(map, radius, center);
  const pingLayer = createPingLayer(center);
  // Плашка прогноза — поверх фишек.
  const plates = new Container();
  const territoryLabels = new Container();
  // Слои карты (art/style-guide.md): армии (10) ниже подписей городов и государств (12).
  top.addChild(
    maskGpu.container,
    territory.over,
    planLayer.container,
    marks,
    mapIcons.container,
    queueMarks,
    hexLabels,
    unitLayer.container,
    labels,
    territoryLabels,
    plates,
    pingLayer.container,
  );
  let view: PlayerView | null = null;
  let selected: SandboxSelection = NOTHING;
  let draft: Draft | null = null;
  let selectedArmy: number | null = null;
  let roadPreviewPath: readonly number[] | null = null;
  let orderTarget: OrderTarget | null = null;
  let battlePanel: MarkerAnchor | null = null;
  let scale = 1;
  let level: DetailLevel = 2;
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frameMs = 0;
  let previousOwners: Int16Array | null = null;
  let previousRoad: Uint8Array | null = null;
  let previousLink: Uint8Array | null = null;
  let previousCityHexes = '';
  // Дерево рёбер дорог пересобирается только при смене дорог; толщина и пунктир — при каждом зуме.
  let roadEdges: [number, number][] | null = null;
  const capturesByHex = new Map<number, { readonly started: number; readonly color: string }>();
  const cityFlashes = new Map<number, { readonly started: number; readonly color: string }>();
  let labelsKey = '';
  let territoryKey = '';

  const allHexIds: ReadonlySet<number> = new Set(
    Array.from({ length: map.width * map.height }, (_, id) => id),
  );

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
    const cityIds = new Set(v.cities.map((city) => city.id));
    pruneEconomyLayerCaches(capturesByHex, cityFlashes, allHexIds, cityIds);
    previousOwners = v.hexes.owner.slice();
  }

  // Вспышка захвата рисуется шейдером: здесь лишь остаток эффекта каждого гекса уходит в текстуру.
  function drawCaptureEffects(): void {
    for (const [id, effect] of capturesByHex) {
      const progress = captureProgress(frameMs - effect.started, reducedMotion);
      if (progress >= 1) {
        capturesByHex.delete(id);
        territory.setCapture(id, 0);
        continue;
      }
      territory.setCapture(id, 1 - progress);
    }
    territory.flush();
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
          .moveTo(p.x, p.y - radius * ARC_RADIUS)
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
    roadEdges ??= roadTree(map, v);
    for (const [a, b] of roadEdges) {
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

  // Знаки строений — только у гексов, где что-то построено, а не по объекту на каждый гекс карты.
  // Слои гексов пересоздаются только при изменении, поэтому неизменные ссылки на массивы значат
  // «ничего не поменялось»: обход всей карты на каждый вид не нужен.
  let builtCache: {
    readonly building: PlayerView['hexes']['building'];
    readonly improvement: PlayerView['hexes']['improvement'];
    readonly owner: PlayerView['hexes']['owner'];
    readonly cities: PlayerView['cities'];
    readonly out: ConstructionGlyph[];
  } | null = null;

  function builtHexes(v: PlayerView): ConstructionGlyph[] {
    const { building: buildings, improvement: improvements, owner: owners } = v.hexes;
    if (
      builtCache !== null &&
      builtCache.building === buildings &&
      builtCache.improvement === improvements &&
      builtCache.owner === owners &&
      builtCache.cities === v.cities
    ) {
      return builtCache.out;
    }
    const out: ConstructionGlyph[] = [];
    const cityHexes = new Set(v.cities.map((c) => c.hex));
    for (let hex = 0; hex < buildings.length; hex += 1) {
      const building = buildings[hex] ?? 0;
      const improvement = improvements[hex] ?? 0;
      if (building === 0 && improvement <= 0) continue;
      out.push({
        at: center(hex),
        color: playerLine(owners[hex] ?? -1),
        building,
        improvement,
        city: cityHexes.has(hex),
        port: isDepot(building) && waterNeighbors(map, hex).length > 0,
      });
    }
    builtCache = {
      building: buildings,
      improvement: improvements,
      owner: owners,
      cities: v.cities,
      out,
    };
    return out;
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
      shared: (v.hexes.building[c.hex] ?? 0) !== 0 || (v.hexes.improvement[c.hex] ?? 0) > 0,
    }));
    mapIcons.sync([
      ...drawCities(marks, glyphs, k, radius),
      ...drawConstructions(marks, builtHexes(v), k, radius),
    ]);
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
    const nextTerritoryLabels = buildTerritoryLabels(v, map.width, radius);
    const nextTerritoryKey = territoryLabelsKey(nextTerritoryLabels, scale, level);
    if (nextTerritoryKey !== territoryKey) {
      territoryKey = nextTerritoryKey;
      drawTerritoryLabels(territoryLabels, nextTerritoryLabels, scale, level);
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
    for (const p of plates.removeChildren()) p.destroy({ children: true, context: true });
    if (orderTarget) {
      const at = center(orderTarget.hex);
      marks.poly(hexPolygon(at, radius)).stroke({
        color: orderTarget.badge ? tokens.status.danger : tokens.ui.ink,
        width: MARK_WIDTH_PX * k,
      });
      // Над целевым гексом, выше фишек (art/units.md, «Плашка прогноза»).
      if (orderTarget.badge) drawForecastPlate(plates, orderTarget.badge, at, k, PLATE_LIFT_PX);
    }
    if (battlePanel && view) {
      drawBattlePanel(plates, battleSides(view, battlePanel.targetHex), battlePanel.at, k);
    }
  }

  const sameArray = (a: ArrayLike<number> | null, b: ArrayLike<number>): boolean => {
    if (a === b) return true;
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < b.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  };

  // Дороги пересобираются только при смене дорог, связей, владельцев или городов.
  const roadsChanged = (v: PlayerView): boolean => {
    const cityHexes = v.cities.map((city) => `${city.id}:${city.hex}`).join(',');
    const changed =
      !sameArray(previousRoad, v.hexes.road) ||
      !sameArray(previousLink, v.hexes.link) ||
      !sameArray(previousOwners, v.hexes.owner) ||
      cityHexes !== previousCityHexes;
    if (changed) {
      previousRoad = v.hexes.road.slice();
      previousLink = v.hexes.link.slice();
      previousCityHexes = cityHexes;
      roadEdges = null;
    }
    return changed;
  };

  const redraw = (): void => {
    if (!view) return;
    drawRoadPreview(view);
    drawMarks(view);
    drawConstructionEffects(view);
    drawCaptureEffects();
    drawCityFlashEffects(view);
    planLayer.setView(view, draft, selectedArmy, scale, level);
  };

  return {
    container,
    top,
    territoryLabels,
    update(s, l) {
      scale = s;
      level = l;
      unitLayer.setScale(s);
      territory.setScale(s);
      maskGpu.setScale(s);
      redraw();
      if (view) drawRoads(view);
    },
    setView(v, sel) {
      const roads = roadsChanged(v);
      rememberEffects(v, performance.now());
      view = v;
      selected = sel;
      territory.setView(v);
      redraw();
      if (roads) drawRoads(v);
      if (typeof document !== 'undefined') unitLayer.setView(v, sel, performance.now());
    },
    setPolitical(on) {
      territory.setPolitical(on);
    },
    cacheTelemetry() {
      return {
        ...unitLayer.cacheTelemetry(),
        economy: economyLayerCacheTelemetry(capturesByHex, cityFlashes),
        frontTween: planLayer.cacheTelemetry(),
      };
    },
    setOrderTarget(t) {
      orderTarget = t;
      redraw();
    },
    setBattlePanel(m) {
      if (m?.sourceHex === battlePanel?.sourceHex && m?.targetHex === battlePanel?.targetHex)
        return;
      battlePanel = m;
      redraw();
    },
    battleMarkerAt(world) {
      return unitLayer.battleMarkerAt(world);
    },
    chipAt(hex) {
      return unitLayer.chipAt(hex);
    },
    chipBounds(unitId) {
      return unitLayer.chipBounds(unitId);
    },
    unitsAt(world) {
      return unitLayer.unitsAt(world);
    },
    setSelectedArmy(id) {
      selectedArmy = id;
      redraw();
    },
    setPlanHover(world) {
      planLayer.setHover(world);
    },
    setHexLabels(entries) {
      hexLabels
        .removeChildren()
        .forEach((child) => child.destroy({ children: true, context: true }));
      for (const entry of entries) {
        const at = center(entry.hex);
        const label = new Text({
          text: entry.text,
          style: {
            fontFamily: tokens.font.ui.family,
            fontWeight: '600',
            fontSize: radius * 0.5,
            fill: tokens.ui.ink,
          },
        });
        label.resolution = (globalThis.window?.devicePixelRatio ?? 1) * 2;
        label.anchor.set(0, 0.5);
        const coin = radius * 0.26;
        const gap = radius * 0.1;
        const pad = radius * 0.14;
        const width = pad + coin * 2 + gap + label.width + pad;
        const height = radius * 0.66;
        const left = at.x - width / 2;
        // Плашка с монетой: цена высадки, как золото в сигнале границы.
        const badge = new Graphics()
          .roundRect(left, at.y - height / 2, width, height, height / 2)
          .fill(tokens.ui.surface)
          .stroke({ color: tokens.ui.ink, width: 1.2 })
          .circle(left + pad + coin, at.y, coin)
          .fill(tokens.selection.color)
          .stroke({ color: tokens.ui.ink, width: 1 });
        label.position.set(left + pad + coin * 2 + gap, at.y);
        hexLabels.addChild(badge, label);
      }
    },
    setQueueMarks(hexes) {
      queueMarks
        .removeChildren()
        .forEach((child) => child.destroy({ children: true, context: true }));
      hexes.forEach((hex, i) => {
        const at = center(hex);
        const badge = new Graphics()
          .circle(at.x, at.y, radius * 0.34)
          .fill(tokens.ui.surface)
          .stroke({ color: tokens.selection.color, width: 1.5 });
        const label = new Text({
          text: String(i + 1),
          style: {
            fontFamily: tokens.font.ui.family,
            fontWeight: '500',
            fontSize: radius * 0.5,
            fill: tokens.ui.ink,
          },
        });
        label.resolution = (globalThis.window?.devicePixelRatio ?? 1) * 2;
        label.anchor.set(0.5);
        label.position.set(at.x, at.y);
        queueMarks.addChild(badge, label);
      });
    },
    setMapMask(kind, mask) {
      maskGpu.setMask(kind, mask);
    },
    setRoadPreview(path) {
      roadPreviewPath = path;
      redraw();
    },
    setDraft(d) {
      draft = d;
      redraw();
    },
    addPing(hex, kind, owner) {
      pingLayer.add(hex, kind, owner, frameMs);
    },
    setStartMarker(hex) {
      pingLayer.setMarker(hex);
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
      pingLayer.frame(nowMs, scale);
    },
    destroy() {
      territory.destroy();
      maskGpu.destroy();
      mapIcons.destroy();
      pingLayer.destroy();
      container.destroy({ children: true, context: true });
      top.destroy({ children: true, context: true });
    },
  };
}
