// Геометрия планов армий (CR-002, CR-003): своя граница (с врагом или ничьей землёй), участок
// фронта — цепочка своих пограничных гексов, которая едет за границей; линии обороны и
// наступления по точкам.
// GDD: docs/gdd/07-controls.md — «Планы армий».
import type { ArmyPlan, MatchState } from './types.ts';
import { TERRAIN, type MapStatic } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';

/** Карта и владельцы гексов — общее у состояния матча и снимка игрока (для превью линий). */
export interface LineGround {
  readonly map: MapStatic;
  readonly hexes: { readonly owner: Int16Array };
}

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

function borderSet(state: LineGround, owner: number): Set<HexId> {
  const out = new Set<HexId>();
  state.hexes.owner.forEach((o, id) => {
    if (o === owner && isBorderHex(state, owner, id)) out.add(id);
  });
  return out;
}

// Порядок вдоль границы: обход в глубину от «конца» (гекс с наименьшим числом соседей в наборе),
// к меньшему HexId.
function orderChain(state: LineGround, comp: readonly HexId[]): HexId[] {
  const set = new Set(comp);
  const nbrs = (h: HexId): HexId[] =>
    adjacent(state, h)
      .filter((n) => set.has(n))
      .sort((a, b) => a - b);
  const start = [...comp].sort((a, b) => nbrs(a).length - nbrs(b).length || a - b)[0];
  if (start === undefined) return [];
  const out: HexId[] = [];
  const visited = new Set<HexId>();
  const stack = [start];
  while (stack.length > 0) {
    const h = stack.pop() as HexId;
    if (visited.has(h)) continue;
    visited.add(h);
    out.push(h);
    for (const n of nbrs(h).reverse()) if (!visited.has(n)) stack.push(n);
  }
  return out;
}

/**
 * Непрерывный кусок границы с игроком enemy, содержащий гекс hex (свой гекс у этой границы):
 * связные свои гексы, граничащие с enemy. Оторванные куски той же границы не входят.
 * @returns гексы по порядку вдоль границы; пусто, если hex не у границы с enemy
 */
export function borderSegment(
  state: LineGround,
  owner: number,
  enemy: number,
  hex: HexId,
): HexId[] {
  const touches = (h: HexId): boolean =>
    state.hexes.owner[h] === owner &&
    isLand(state, h) &&
    adjacent(state, h).some((n) => state.hexes.owner[n] === enemy);
  if (!touches(hex)) return [];
  const comp = new Set<HexId>([hex]);
  const queue = [hex];
  for (let i = 0; i < queue.length; i += 1) {
    for (const n of adjacent(state, queue[i] as HexId)) {
      if (comp.has(n) || !touches(n)) continue;
      comp.add(n);
      queue.push(n);
    }
  }
  return orderChain(state, [...comp]);
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

// Точки соединяются кратчайшими путями по passable; strict — несоединимые точки дают null,
// иначе куски просто идут подряд.
function linePath(
  state: LineGround,
  points: readonly HexId[],
  passable: (h: HexId) => boolean,
  strict = true,
): HexId[] | null {
  const [start] = points;
  if (start === undefined || !passable(start)) return null;
  const out: HexId[] = [start];
  const seen = new Set(out);
  for (let i = 1; i < points.length; i += 1) {
    const to = points[i] as HexId;
    const path = leg(state, out[out.length - 1] as HexId, to, passable);
    if (!path && strict) return null;
    for (const h of path ?? (passable(to) ? [to] : [])) {
      if (seen.has(h)) continue;
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

/**
 * Участок фронта по точкам: цепочка своих пограничных гексов (граница с врагом или ничьей
 * землёй), между точками — кратчайший путь по гексам границы.
 * @returns гексы по порядку или null, если точки не на своей границе или их не соединить
 */
export function frontLinePath(
  state: LineGround,
  owner: number,
  points: readonly HexId[],
): HexId[] | null {
  const border = borderSet(state, owner);
  return linePath(state, points, (h) => border.has(h));
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
 * Линия наступления по точкам: кратчайший путь по любым проходимым гексам (свои, чужие, ничьи).
 * @returns гексы линии по порядку или null, если точки не соединить
 */
export function offensiveLinePath(state: LineGround, points: readonly HexId[]): HexId[] | null {
  return linePath(state, points, (h) => isLand(state, h));
}

// Ближайший гекс набора (при равенстве — меньший HexId).
function nearestOf(state: LineGround, set: ReadonlySet<HexId>, hex: HexId): HexId | undefined {
  const { width } = state.map;
  const at = hexFromId(hex, width);
  let best: HexId | undefined;
  let bestD = Number.MAX_SAFE_INTEGER;
  for (const h of set) {
    const d = distance(at, hexFromId(h, width));
    if (d < bestD || (d === bestD && h < (best ?? Number.MAX_SAFE_INTEGER))) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/**
 * Фронт едет за границей: гексы участка, переставшие быть своей границей, переносятся на
 * ближайший гекс новой границы, соседние — соединяются по границе. Нет границы — план не меняется.
 */
export function followBorder(state: MatchState, armyId: number): void {
  const i = state.plans.findIndex((p) => p.armyId === armyId);
  const plan = state.plans[i];
  const owner = state.armies.find((a) => a.id === armyId)?.owner;
  if (plan?.kind !== 'front' || owner === undefined) return;
  const border = borderSet(state, owner);
  if (border.size === 0 || plan.hexes.every((h) => border.has(h))) return;
  const points: HexId[] = [];
  for (const h of plan.hexes) {
    const s = border.has(h) ? h : nearestOf(state, border, h);
    if (s !== undefined && points.at(-1) !== s) points.push(s);
  }
  const hexes = linePath(state, points, (h) => border.has(h), false) ?? [];
  state.plans[i] = { ...plan, hexes };
}

/**
 * Текущие гексы плана армии по порядку: для фронта — гексы участка, ещё стоящие на своей
 * границе; для линии обороны — свои проходимые гексы линии (потерянные пропускаются).
 */
export function planHexes(state: MatchState, plan: ArmyPlan): HexId[] {
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  if (owner === undefined) return [];
  if (plan.kind === 'line') {
    return plan.hexes.filter((h) => state.hexes.owner[h] === owner && isLand(state, h));
  }
  return plan.hexes.filter((h) => isBorderHex(state, owner, h));
}
