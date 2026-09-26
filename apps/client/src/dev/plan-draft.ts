// Инструменты планов армии как в HoI4 (07-controls.md, «Планы армий», CR-004): фронт и линия
// наступления рисуются по граням, линия обороны — по своим гексам; отпустил палец — приказ отдан.
// Тап по границе с врагом — фронт на весь её непрерывный кусок, по другой грани границы — фронт
// из одной грани. «Удалить» — тап по линии убирает её. Ручки на концах фронта тянут участок.
import {
  borderSegmentEdges,
  cornerKey,
  cornerPath,
  edgeCorners,
  defenseLinePath,
  edgeOther,
  flipEdge,
  frontEdgePath,
  hexFromId,
  hexId,
  inBounds,
  isBorderEdge,
  isLandEdge,
  landEdgePath,
  TERRAIN,
  type Command,
  type Corner,
  type EdgeId,
  type MapStatic,
  type PlanView,
  type PlayerView,
} from '@hexfront/sim';

import { cornerPoint, edgeMid, nearestCorner, nearestEdge } from './plan-edges.ts';
import { hexCenter, pixelToHex, type Point } from '../render/hex-geometry.ts';

export type Tool = 'front' | 'offensive' | 'line' | 'erase';

/** Рисуемый план: инструмент, армия и то, что уже провёл палец. */
export interface Draft {
  readonly tool: Tool;
  readonly armyId: number;
  readonly edges: readonly EdgeId[];
  readonly hexes: readonly number[];
  /** Наступление: последний угол, до которого довели линию (путь идёт по углам гексов). */
  readonly corner: Corner | null;
}

export interface DraftContext {
  readonly map: MapStatic;
  readonly view: PlayerView;
  readonly radius: number;
}

export const startDraft = (tool: Tool, armyId: number): Draft => ({
  tool,
  armyId,
  edges: [],
  hexes: [],
  corner: null,
});

const ground = (c: DraftContext): { map: MapStatic; hexes: { owner: Int16Array } } => ({
  map: c.map,
  hexes: c.view.hexes,
});

/** Своя сторона грани своей границы или null. */
function ownBorder(c: DraftContext, e: EdgeId): EdgeId | null {
  const g = ground(c);
  const me = c.view.playerId;
  if (isBorderEdge(g, me, e)) return e;
  const f = flipEdge(g, e);
  return f >= 0 && isBorderEdge(g, me, f) ? f : null;
}

function hexUnder(c: DraftContext, world: Point): number {
  const h = pixelToHex(world, c.radius);
  return inBounds(h, c.map.width, c.map.height) ? hexId(h, c.map.width) : -1;
}

/** Палец ведёт линию: добавляет ближайшую грань (или свой гекс для линии обороны). */
export function strokeAdd(c: DraftContext, d: Draft, world: Point): Draft {
  if (d.tool === 'line') {
    const h = hexUnder(c, world);
    const ok =
      h >= 0 && c.map.terrain[h] !== TERRAIN.water && c.view.hexes.owner[h] === c.view.playerId;
    return ok && d.hexes.at(-1) !== h ? { ...d, hexes: [...d.hexes, h] } : d;
  }
  if (d.tool === 'erase') return d;
  const g = ground(c);
  if (d.tool === 'offensive') {
    // Наступление — по углам гексов: цепочка граней без ответвлений и обрывков.
    const corner = nearestCorner(c.map, c.radius, world);
    if (!corner) return d;
    if (!d.corner) return { ...d, corner };
    if (cornerKey(g, corner) === cornerKey(g, d.corner)) return d;
    const path = cornerPath(g, d.corner, corner, (x) => isLandEdge(g, x));
    return path ? { ...d, corner, edges: [...d.edges, ...path] } : d;
  }
  const e = nearestEdge(c.map, c.radius, world, (x) => ownBorder(c, x) !== null);
  if (e === null) return d;
  const x = ownBorder(c, e) as EdgeId;
  return d.edges.at(-1) === x ? d : { ...d, edges: [...d.edges, x] };
}

/** Отпустил палец: приказ по проведённой линии (или null, если линии нет). */
export function finishCommand(d: Draft): Command | null {
  if (d.tool === 'front' && d.edges.length > 0) {
    return { t: 'assignFront', armyId: d.armyId, edges: d.edges };
  }
  if (d.tool === 'offensive' && d.edges.length > 0) {
    return { t: 'setOffensiveLine', armyId: d.armyId, edges: d.edges };
  }
  if (d.tool === 'line' && d.hexes.length > 0) {
    return { t: 'setDefenseLine', armyId: d.armyId, points: d.hexes };
  }
  return null;
}

// Ближайшая линия своих планов к точке (для «Удалить»): расстояние до середин граней и центров.
function hitPlan(c: DraftContext, world: Point): Command | null {
  const max = c.radius * 0.6;
  let best: { cmd: Command; d: number } | null = null;
  const near = (pts: readonly Point[], cmd: Command): void => {
    for (const p of pts) {
      const d = Math.hypot(p.x - world.x, p.y - world.y);
      if (d <= max && (!best || d < best.d)) best = { cmd, d };
    }
  };
  const mid = (e: EdgeId): Point => edgeMid(c.map, c.radius, e);
  for (const p of c.view.plans) {
    if (p.kind === 'line') {
      near(
        p.hexes.map((h) => hexCenter(hexFromId(h, c.map.width), c.radius)),
        { t: 'clearPlan', armyId: p.armyId },
      );
      continue;
    }
    near(p.edges.map(mid), { t: 'clearPlan', armyId: p.armyId });
    if (p.offensive) near(p.offensive.edges.map(mid), { t: 'clearOffensive', armyId: p.armyId });
  }
  return (best as { cmd: Command } | null)?.cmd ?? null;
}

/**
 * Тап в режиме инструмента. Фронт: грань границы с врагом — весь непрерывный кусок, другая грань
 * своей границы — фронт из этой грани. «Удалить»: линия под пальцем.
 * @returns приказ или null
 */
export function tapCommand(c: DraftContext, d: Draft, world: Point): Command | null {
  if (d.tool === 'erase') return hitPlan(c, world);
  if (d.tool !== 'front') return null;
  const e = nearestEdge(c.map, c.radius, world, (x) => ownBorder(c, x) !== null);
  const own = e === null ? null : ownBorder(c, e);
  if (own === null) return null;
  const g = ground(c);
  const other = c.view.hexes.owner[edgeOther(g, own)] ?? -1;
  const edges = other >= 0 ? borderSegmentEdges(g, c.view.playerId, other, own) : [own];
  return { t: 'assignFront', armyId: d.armyId, edges };
}

/** Что подсветить: грани (фронт, наступление) или гексы (оборона) — так, как достроит sim. */
export function draftPath(c: DraftContext, d: Draft): { edges: EdgeId[]; hexes: number[] } {
  const g = ground(c);
  if (d.tool === 'front') {
    return { edges: frontEdgePath(g, c.view.playerId, d.edges) ?? [...d.edges], hexes: [] };
  }
  if (d.tool === 'offensive') return { edges: landEdgePath(g, d.edges) ?? [...d.edges], hexes: [] };
  if (d.tool === 'line') {
    return { edges: [], hexes: defenseLinePath(g, c.view.playerId, d.hexes) ?? [...d.hexes] };
  }
  return { edges: [], hexes: [] };
}

/**
 * Точки ручек на концах фронта: внешние углы первой и последней грани (угол, не общий с
 * соседней гранью участка).
 */
export function frontHandles(c: DraftContext, plan: PlanView & { kind: 'front' }): Point[] {
  const g = ground(c);
  const outer = (e: EdgeId | undefined, next: EdgeId | undefined): Point | null => {
    if (e === undefined) return null;
    const corners = edgeCorners(e);
    const shared = next === undefined ? [] : edgeCorners(next).map((x) => cornerKey(g, x));
    const free = corners.find((x) => !shared.includes(cornerKey(g, x))) ?? corners[0];
    return cornerPoint(c.map, c.radius, free);
  };
  const { edges } = plan;
  if (edges.length === 1) {
    const [a, b] = edgeCorners(edges[0] as EdgeId);
    return [cornerPoint(c.map, c.radius, a), cornerPoint(c.map, c.radius, b)];
  }
  const first = outer(edges[0], edges[1]);
  const last = outer(edges.at(-1), edges.at(-2));
  return first && last ? [first, last] : [];
}

/**
 * Тянем ручку конца фронта: грань под пальцем внутри участка — участок укорачивается до неё,
 * снаружи — удлиняется до неё по граням границы. which — 0 (начало) или 1 (конец).
 * @returns новые грани участка
 */
export function dragFrontEnd(
  c: DraftContext,
  edges: readonly EdgeId[],
  which: 0 | 1,
  world: Point,
): EdgeId[] {
  const chain = which === 1 ? [...edges] : [...edges].reverse();
  const e = nearestEdge(c.map, c.radius, world, (x) => ownBorder(c, x) !== null);
  const own = e === null ? null : ownBorder(c, e);
  if (own === null || chain.length === 0) return [...edges];
  const at = chain.indexOf(own);
  let next: EdgeId[];
  if (at >= 0) next = chain.slice(0, Math.max(1, at + 1));
  else {
    const ext = frontEdgePath(ground(c), c.view.playerId, [chain.at(-1) as EdgeId, own]);
    next = ext ? [...chain, ...ext.slice(1).filter((x) => !chain.includes(x))] : chain;
  }
  return which === 1 ? next : next.reverse();
}
