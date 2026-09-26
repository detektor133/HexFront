// Инструменты планов армии как в HoI4 (07-controls.md, «Планы армий», CR-004): фронт и линия
// наступления рисуются по граням, линия обороны — по своим гексам; отпустил палец — приказ отдан.
// Тап по границе с врагом — фронт на весь её непрерывный кусок, по другой грани границы — фронт
// из одной грани. «Удалить» — тап по линии убирает её. Ручки на концах фронта тянут участок.
import {
  borderSegmentEdges,
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
  type EdgeId,
  type MapStatic,
  type PlanView,
  type PlayerView,
} from '@hexfront/sim';

import { edgeMid, edgeRuns, nearestEdge } from './plan-edges.ts';
import { hexCenter, pixelToHex, type Point } from '../render/hex-geometry.ts';

export type Tool = 'front' | 'offensive' | 'line' | 'erase';

/** Рисуемый план: инструмент, армия и то, что уже провёл палец. */
export interface Draft {
  readonly tool: Tool;
  readonly armyId: number;
  readonly edges: readonly EdgeId[];
  readonly hexes: readonly number[];
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
  const e =
    d.tool === 'front'
      ? nearestEdge(c.map, c.radius, world, (x) => ownBorder(c, x) !== null)
      : nearestEdge(c.map, c.radius, world, (x) => isLandEdge(g, x));
  if (e === null) return d;
  const x = d.tool === 'front' ? (ownBorder(c, e) as EdgeId) : e;
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
    if (p.offensive) near(p.offensive.edges.map(mid), { t: 'stopOffensive', armyId: p.armyId });
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

/** Точки ручек на концах фронта (в мировых координатах): начало и конец ломаной граней. */
export function frontHandles(c: DraftContext, plan: PlanView & { kind: 'front' }): Point[] {
  const runs = edgeRuns(c.map, c.radius, plan.edges);
  const a = runs[0]?.[0];
  const b = runs.at(-1)?.at(-1);
  return a && b ? [a, b] : [];
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
