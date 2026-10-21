// Инструменты планов армии как в HoI4 (07-controls.md, «Планы армий», CR-004): фронт и линия
// наступления рисуются по граням, линия обороны — по своим гексам; отпустил палец — приказ отдан.
// Тап по границе с врагом — фронт на весь её непрерывный кусок, по другой грани границы — фронт
// из одной грани. «Удалить» — тап по линии убирает её. Ручки на концах фронта тянут участок.
import {
  borderSegmentEdges,
  cornerKey,
  edgeCorners,
  defenseLinePath,
  edgeOther,
  flipEdge,
  frontEdgePath,
  frontLinePath,
  hexFromId,
  hexId,
  inBounds,
  isBorderEdge,
  isLandEdge,
  normalizeLine,
  offensiveEdgePath,
  TERRAIN,
  type Command,
  type Corner,
  type EdgeId,
  type MapStatic,
  type PlanView,
  type PlayerView,
} from '@hexfront/sim';

import {
  cornerPoint,
  edgeMid,
  edgeRunIds,
  edgeRuns,
  nearestCorner,
  nearestEdge,
} from './plan-edges.ts';
import { trajectoryPath } from './stroke-path.ts';
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
  /** Наступление: последняя точка пальца (мир) — начало отрезка траектории. */
  readonly last?: Point;
  /** Исходный участок фронта, который заменяется новой линией. */
  readonly replaceEdges?: readonly EdgeId[];
  readonly baseEdges?: readonly EdgeId[];
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

function replaceRun(
  base: readonly EdgeId[],
  replaced: readonly EdgeId[],
  next: readonly EdgeId[],
): EdgeId[] {
  const removed = new Set(replaced);
  const out: EdgeId[] = [];
  for (const edge of [
    ...base.filter((x) => !removed.has(x)),
    ...next.filter((x) => !removed.has(x)),
  ]) {
    if (!out.includes(edge)) out.push(edge);
  }
  return out;
}

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
    // Между углами — путь, ближайший к траектории пальца; возврат в пройденный угол стирает
    // линию до него (normalizeLine).
    const corner = nearestCorner(c.map, c.radius, world);
    if (!corner) return d;
    if (!d.corner) return { ...d, corner, last: world };
    if (cornerKey(g, corner) === cornerKey(g, d.corner)) return { ...d, last: world };
    const seg = [d.last ?? world, world] as const;
    const path = trajectoryPath(g, c.radius, d.corner, corner, seg, (x) => isLandEdge(g, x));
    if (!path) return d;
    return { ...d, corner, last: world, edges: normalizeLine(g, [...d.edges, ...path]) };
  }
  const e = nearestEdge(c.map, c.radius, world, (x) => ownBorder(c, x) !== null);
  if (e === null) return d;
  const x = ownBorder(c, e) as EdgeId;
  if (d.edges.at(-1) === x) return d;
  if (d.tool !== 'front' || d.replaceEdges !== undefined) return { ...d, edges: [...d.edges, x] };
  const plan = c.view.plans.find(
    (p): p is PlanView & { kind: 'front' } => p.armyId === d.armyId && p.kind === 'front',
  );
  if (!plan) return { ...d, edges: [...d.edges, x] };
  const ids = edgeRunIds(c.map, c.radius, plan.edges);
  const runs = edgeRuns(c.map, c.radius, plan.edges);
  const runIndex = runs.findIndex((run) =>
    run.some((p) => Math.hypot(p.x - world.x, p.y - world.y) <= c.radius * 0.6),
  );
  const replaceEdges = ids[runIndex];
  return replaceEdges
    ? { ...d, edges: [x], replaceEdges, baseEdges: plan.edges }
    : { ...d, edges: [...d.edges, x] };
}

function strokePointAccepted(c: DraftContext, d: Draft, world: Point): boolean {
  if (d.tool === 'line') {
    const h = hexUnder(c, world);
    return (
      h >= 0 && c.map.terrain[h] !== TERRAIN.water && c.view.hexes.owner[h] === c.view.playerId
    );
  }
  if (d.tool === 'front') {
    return nearestEdge(c.map, c.radius, world, (x) => ownBorder(c, x) !== null) !== null;
  }
  return true;
}

/** Добавляет все допустимые точки между двумя событиями движения указателя. */
export function strokeSegment(c: DraftContext, d: Draft, from: Point, to: Point): Draft {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / (c.radius * 0.5)));
  if (!strokePointAccepted(c, d, from)) return d;
  let next = strokeAdd(c, d, from);
  if (d.tool === 'line') {
    const target = hexUnder(c, to);
    if (!strokePointAccepted(c, next, to)) return next;
    const last = next.hexes.at(-1);
    if (last === undefined || last === target) return next;
    const path = defenseLinePath(ground(c), c.view.playerId, [last, target]);
    return path ? { ...next, hexes: [...next.hexes, ...path.slice(1)] } : next;
  }
  for (let i = 1; i <= steps; i += 1) {
    const point = {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    };
    if (!strokePointAccepted(c, next, point)) break;
    next = strokeAdd(c, next, point);
  }
  return next;
}

/** Отпустил палец: приказ по проведённой линии (или null, если линии нет). */
export function finishCommand(d: Draft): Command | null {
  if (d.tool === 'front' && d.edges.length > 0) {
    const edges =
      d.replaceEdges && d.baseEdges ? replaceRun(d.baseEdges, d.replaceEdges, d.edges) : d.edges;
    return { t: 'assignFront', armyId: d.armyId, edges };
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
    const runs = edgeRuns(c.map, c.radius, p.edges);
    const ids = edgeRunIds(c.map, c.radius, p.edges);
    runs.forEach((run, i) => {
      const edges = ids[i] ?? [];
      near(
        run,
        edges.length === p.edges.length
          ? { t: 'clearPlan', armyId: p.armyId }
          : { t: 'clearPlan', armyId: p.armyId, edges },
      );
    });
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
    const path = frontLinePath(g, c.view.playerId, d.edges) ?? [...d.edges];
    const edges =
      d.replaceEdges && d.baseEdges ? replaceRun(d.baseEdges, d.replaceEdges, path) : path;
    return { edges, hexes: [] };
  }
  if (d.tool === 'offensive') {
    return { edges: offensiveEdgePath(g, d.edges) ?? [...d.edges], hexes: [] };
  }
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
    // Удлинение — путь от конца участка; порядок и дуга — при показе и в sim (frontLinePath).
    const ext = frontEdgePath(ground(c), c.view.playerId, [chain.at(-1) as EdgeId, own]);
    next = ext ? [...chain, ...ext.slice(1).filter((x) => !chain.includes(x))] : chain;
  }
  return which === 1 ? next : next.reverse();
}
