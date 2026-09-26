// Геометрия планов армий (CR-002): гексы фронта против соседа, их порядок вдоль границы,
// участки, деление фронта между армиями, путь линии обороны.
// GDD: docs/gdd/07-controls.md — «Планы армий».
import type { ArmyPlan, MatchState } from './types.ts';
import { TERRAIN, type MapStatic } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { intDiv } from '../math/int.ts';

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

/**
 * Фронт игрока owner против enemy: свои гексы, граничащие с гексами enemy.
 * @returns HexId по возрастанию
 */
export function frontHexes(state: MatchState, owner: number, enemy: number): HexId[] {
  const out: HexId[] = [];
  state.hexes.owner.forEach((o, id) => {
    if (o !== owner) return;
    if (adjacent(state, id).some((n) => state.hexes.owner[n] === enemy)) out.push(id);
  });
  return out;
}

// Порядок вдоль границы: компоненты по наименьшему HexId; в компоненте — обход в глубину от
// «конца» (гекс с наименьшим числом соседей по фронту), к меньшему HexId.
function orderChain(state: MatchState, hexes: readonly HexId[]): HexId[] {
  const set = new Set(hexes);
  const nbrs = (h: HexId): HexId[] =>
    adjacent(state, h)
      .filter((n) => set.has(n))
      .sort((a, b) => a - b);
  const seen = new Set<HexId>();
  const out: HexId[] = [];
  for (const first of hexes) {
    if (seen.has(first)) continue;
    const comp: HexId[] = [];
    const queue = [first];
    seen.add(first);
    while (queue.length > 0) {
      const h = queue.shift() as HexId;
      comp.push(h);
      for (const n of nbrs(h)) if (!seen.has(n) && (seen.add(n), true)) queue.push(n);
    }
    comp.sort((a, b) => nbrs(a).length - nbrs(b).length || a - b);
    const visited = new Set<HexId>();
    const stack = [comp[0] as HexId];
    while (stack.length > 0) {
      const h = stack.pop() as HexId;
      if (visited.has(h)) continue;
      visited.add(h);
      out.push(h);
      for (const n of nbrs(h).reverse()) if (!visited.has(n)) stack.push(n);
    }
  }
  return out;
}

// Ближайший к точке гекс фронта (при равенстве — меньший HexId).
function snap(state: MatchState, chain: readonly HexId[], hex: HexId): HexId | undefined {
  const { width } = state.map;
  const at = hexFromId(hex, width);
  let best: HexId | undefined;
  let bestD = Infinity;
  for (const h of chain) {
    const d = distance(at, hexFromId(h, width));
    if (d < bestD || (d === bestD && h < (best ?? Infinity))) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

// Участок: кратчайшая цепочка по гексам фронта между концами (концы — ближайшие гексы фронта).
function section(
  state: MatchState,
  chain: readonly HexId[],
  ends: readonly [HexId, HexId],
): HexId[] {
  const a = snap(state, chain, ends[0]);
  const b = snap(state, chain, ends[1]);
  if (a === undefined || b === undefined) return [];
  const set = new Set(chain);
  const prev = new Map<HexId, HexId>([[a, a]]);
  const queue = [a];
  while (queue.length > 0 && !prev.has(b)) {
    const h = queue.shift() as HexId;
    for (const n of adjacent(state, h).sort((x, y) => x - y)) {
      if (!set.has(n) || prev.has(n)) continue;
      prev.set(n, h);
      queue.push(n);
    }
  }
  if (!prev.has(b)) return [a];
  const path: HexId[] = [b];
  for (let h = b; h !== a; h = prev.get(h) as HexId) path.push(prev.get(h) as HexId);
  return path.reverse();
}

function armySoldiers(state: MatchState, armyId: number): number {
  let n = 0;
  for (const u of state.units) if (u.armyId === armyId) n += u.soldiers;
  return n;
}

// Армии на всей границе с одним соседом делят цепочку на смежные куски пропорционально солдатам.
function shareOf(state: MatchState, plan: ArmyPlan & { kind: 'front' }, chain: HexId[]): HexId[] {
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  const sharing = state.plans.filter(
    (p) =>
      p.kind === 'front' &&
      p.section === null &&
      p.enemyId === plan.enemyId &&
      state.armies.find((a) => a.id === p.armyId)?.owner === owner,
  );
  if (sharing.length <= 1) return chain;
  const weights = sharing.map((p) => Math.max(1, armySoldiers(state, p.armyId)));
  const total = weights.reduce((s, w) => s + w, 0);
  let before = 0;
  for (let i = 0; i < sharing.length; i += 1) {
    const w = weights[i] ?? 0;
    if (sharing[i]?.armyId === plan.armyId) {
      const from = intDiv(chain.length * before, total);
      const to = intDiv(chain.length * (before + w), total);
      return chain.slice(from, Math.max(to, from + 1));
    }
    before += w;
  }
  return chain;
}

/**
 * Текущие гексы плана армии по порядку: для фронта — её доля границы или участок, для линии
 * обороны — свои проходимые гексы линии (потерянные пропускаются).
 */
export function planHexes(state: MatchState, plan: ArmyPlan): HexId[] {
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  if (owner === undefined) return [];
  if (plan.kind === 'line') {
    return plan.hexes.filter(
      (h) => state.hexes.owner[h] === owner && state.map.terrain[h] !== TERRAIN.water,
    );
  }
  const chain = orderChain(state, frontHexes(state, owner, plan.enemyId));
  if (plan.section) return section(state, chain, plan.section);
  return shareOf(state, plan, chain);
}

/**
 * Линия обороны по точкам: между соседними точками — кратчайший путь (по числу гексов) по своей
 * проходимой земле, ничьи — по меньшему HexId.
 * @returns гексы линии по порядку или null, если какие-то точки не соединить
 */
export function defenseLinePath(
  state: LineGround,
  owner: number,
  points: readonly HexId[],
): HexId[] | null {
  return linePath(
    state,
    points,
    (h) => state.hexes.owner[h] === owner && state.map.terrain[h] !== TERRAIN.water,
  );
}

/**
 * Линия наступления по точкам: кратчайший путь по любым проходимым гексам (свои, чужие, ничьи).
 * @returns гексы линии по порядку или null, если точки не соединить
 */
export function offensiveLinePath(state: LineGround, points: readonly HexId[]): HexId[] | null {
  return linePath(state, points, (h) => state.map.terrain[h] !== TERRAIN.water);
}

// Точки соединяются кратчайшими по числу гексов путями, ничьи — по меньшему HexId.
function linePath(
  state: LineGround,
  points: readonly HexId[],
  passable: (h: HexId) => boolean,
): HexId[] | null {
  const [start] = points;
  if (start === undefined || !passable(start)) return null;
  const out: HexId[] = [start];
  for (let i = 1; i < points.length; i += 1) {
    const from = out[out.length - 1] as HexId;
    const to = points[i] as HexId;
    const prev = new Map<HexId, HexId>([[from, from]]);
    const queue = [from];
    while (queue.length > 0 && !prev.has(to)) {
      const h = queue.shift() as HexId;
      for (const n of adjacent(state, h).sort((x, y) => x - y)) {
        if (prev.has(n) || !passable(n)) continue;
        prev.set(n, h);
        queue.push(n);
      }
    }
    if (!prev.has(to)) return null;
    const leg: HexId[] = [];
    for (let h = to; h !== from; h = prev.get(h) as HexId) leg.push(h);
    for (const h of leg.reverse()) if (!out.includes(h)) out.push(h);
  }
  return out;
}
