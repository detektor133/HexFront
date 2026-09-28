// Геометрия планов армий (CR-002…CR-004): участок фронта — цепочка граней своей границы (с врагом
// или ничьей землёй), которая едет за границей; линия обороны — по своим гексам.
// GDD: docs/gdd/07-controls.md — «Планы армий».
import { edgeHex, edgeHexes, edgeOther } from './edges.ts';
import { followEdges } from './front-follow.ts';
import type { LineGround } from './ground.ts';
import type { ArmyPlan, MatchState } from './types.ts';
import { TERRAIN } from '../map/types.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';

export type { LineGround } from './ground.ts';

function adjacent(state: LineGround, hex: HexId): HexId[] {
  const { width, height } = state.map;
  const out: HexId[] = [];
  for (const n of neighbors(hexFromId(hex, width))) {
    if (inBounds(n, width, height)) out.push(hexId(n, width));
  }
  return out;
}

const isLand = (state: LineGround, h: HexId): boolean => state.map.terrain[h] !== TERRAIN.water;

/** Свой проходимый гекс, у которого есть соседняя чужая или ничья суша — гекс своей границы. */
export function isBorderHex(state: LineGround, owner: number, hex: HexId): boolean {
  if (state.hexes.owner[hex] !== owner || !isLand(state, hex)) return false;
  return adjacent(state, hex).some((n) => state.hexes.owner[n] !== owner && isLand(state, n));
}

// Кратчайший путь по проходимым гексам (ничьи — по меньшему HexId) или null.
function leg(
  state: LineGround,
  from: HexId,
  to: HexId,
  passable: (h: HexId) => boolean,
): HexId[] | null {
  const prev = new Map<HexId, HexId>([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !prev.has(to); i += 1) {
    const h = queue[i] as HexId;
    for (const n of adjacent(state, h).sort((x, y) => x - y)) {
      if (prev.has(n) || !passable(n)) continue;
      prev.set(n, h);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return null;
  const out: HexId[] = [];
  for (let h = to; h !== from; h = prev.get(h) as HexId) out.push(h);
  return out.reverse();
}

// Точки соединяются кратчайшими путями по passable; несоединимые точки дают null.
function linePath(
  state: LineGround,
  points: readonly HexId[],
  passable: (h: HexId) => boolean,
): HexId[] | null {
  const [start] = points;
  if (start === undefined || !passable(start)) return null;
  const out: HexId[] = [start];
  const seen = new Set(out);
  for (let i = 1; i < points.length; i += 1) {
    const path = leg(state, out[out.length - 1] as HexId, points[i] as HexId, passable);
    if (!path) return null;
    for (const h of path) {
      if (seen.has(h)) continue;
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

/**
 * Линия обороны по точкам: кратчайший путь (по числу гексов) по своей проходимой земле.
 * @returns гексы линии по порядку или null, если какие-то точки не соединить
 */
export function defenseLinePath(
  state: LineGround,
  owner: number,
  points: readonly HexId[],
): HexId[] | null {
  return linePath(state, points, (h) => state.hexes.owner[h] === owner && isLand(state, h));
}

/**
 * Фронт едет за границей: переносит участки фронта, у которых есть грань гекса hex (с любой
 * стороны), — после каждой смены владельца этого гекса (setHexOwner). Остальные не трогает.
 */
export function followFrontsNear(state: MatchState, hex: HexId): void {
  state.plans.forEach((plan, i) => {
    if (plan.kind !== 'front') return;
    if (!plan.edges.some((e) => edgeHex(e) === hex || edgeOther(state, e) === hex)) return;
    const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
    if (owner === undefined) return;
    const capitalId = state.players[owner]?.capitalCityId;
    const capital = state.cities.find((c) => c.id === capitalId && c.owner === owner)?.hex ?? -1;
    const edges = followEdges(state, owner, plan.edges, capital);
    if (edges.length !== plan.edges.length || edges.some((e, k) => e !== plan.edges[k])) {
      state.plans[i] = { ...plan, edges };
    }
  });
}

/**
 * Текущие гексы плана армии по порядку: для фронта — гексы его граней (план уже на границе);
 * для линии обороны — свои проходимые гексы линии (потерянные пропускаются).
 */
export function planHexes(state: MatchState, plan: ArmyPlan): HexId[] {
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  if (owner === undefined) return [];
  if (plan.kind === 'line') {
    return plan.hexes.filter((h) => state.hexes.owner[h] === owner && isLand(state, h));
  }
  return edgeHexes(plan.edges).filter((h) => isBorderHex(state, owner, h));
}
