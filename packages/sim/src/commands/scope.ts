// Охват направления армии и раздел границы между армиями одного охвата (07-controls.md, «Охват и
// раздел»). Охват — одна страна или весь блок врагов (страна цели и её союзники, с которыми идёт
// война); он выбирается при приказе и дальше не меняется, когда враги объединяются или распадаются.
// Несколько армий одного охвата делят его границу на участки сами.
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { intDiv } from '../math/int.ts';
import { borderEdges, borderSegmentEdges, edgeHex, type EdgeId } from '../state/edges.ts';
import { atWar, isAllied } from '../state/relations.ts';
import type { Army, MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/** Ничья земля как цель направления. */
const NEUTRAL = -1;

/**
 * Блок цели: она сама и её союзники, с которыми мы воюем. Без `bloc` охват — только сама страна.
 * @returns признак «гекс этого владельца — враг направления»
 */
export function blocOf(
  state: MatchState,
  playerId: number,
  target: number,
  bloc = false,
): (who: number) => boolean {
  if (target === NEUTRAL || !bloc) return (who) => who === target;
  const members = new Set<number>([target]);
  for (const p of state.players) {
    if (p.id !== playerId && isAllied(state, target, p.id) && atWar(state, playerId, p.id)) {
      members.add(p.id);
    }
  }
  return (who) => members.has(who);
}

/**
 * Охват нового приказа: блок, если у цели есть союзники на войне с нами, иначе одна страна. Если
 * границу цели уже держит другая армия на весь блок, новая армия усиливает только эту страну.
 * @param except армия, которой отдаётся приказ (её прежний охват в счёт не идёт)
 */
export function wantsBloc(
  state: MatchState,
  playerId: number,
  target: number,
  except = -1,
): boolean {
  if (target < 0) return false;
  const covered = state.armies.some(
    (a) =>
      a.id !== except &&
      a.owner === playerId &&
      a.dir?.bloc === true &&
      a.dir.mode !== 'idle' &&
      blocOf(state, playerId, a.dir.target, true)(target),
  );
  if (covered) return false;
  return state.players.some(
    (p) => p.id !== target && blocOf(state, playerId, target, true)(p.id) && p.status === 'alive',
  );
}

/** Охват приказа (блок, плацдарм), который переходит в каждое новое состояние направления. */
export function keepScope(dir: NonNullable<Army['dir']>): {
  bloc?: true;
  pocket?: number;
} {
  return {
    ...(dir.bloc === true ? { bloc: true as const } : {}),
    ...(dir.pocket === undefined ? {} : { pocket: dir.pocket }),
  };
}

/**
 * Своя суша, связная с гексом hex (для плацдарма десанта).
 * @returns гексы или null, если hex не наш
 */
export function pocketHexes(state: MatchState, owner: number, hex: HexId): Set<HexId> | null {
  const { width, height } = state.map;
  const own = (h: HexId): boolean =>
    state.hexes.owner[h] === owner && state.map.terrain[h] !== TERRAIN.water;
  if (!own(hex)) return null;
  const land = new Set<HexId>([hex]);
  const queue = [hex];
  for (let i = 0; i < queue.length; i += 1) {
    for (const n of neighbors(hexFromId(queue[i] as HexId, width))) {
      if (!inBounds(n, width, height)) continue;
      const id = hexId(n, width);
      if (land.has(id) || !own(id)) continue;
      land.add(id);
      queue.push(id);
    }
  }
  return land;
}

/** Куски своей границы с охватом, каждый — упорядоченная цепочка граней. */
export function borderPieces(
  state: MatchState,
  playerId: number,
  target: number,
  bloc = false,
  pocket?: number,
): EdgeId[][] {
  const isEnemy = blocOf(state, playerId, target, bloc);
  const pieces: EdgeId[][] = [];
  const seen = new Set<EdgeId>();
  for (const e of borderEdges(state, playerId)) {
    if (seen.has(e)) continue;
    const piece = borderSegmentEdges(state, playerId, isEnemy, e);
    for (const x of piece) seen.add(x);
    if (piece.length > 0) pieces.push(piece);
  }
  if (pocket === undefined) return pieces;
  const land = pocketHexes(state, playerId, pocket);
  return land ? pieces.filter((p) => land.has(edgeHex(p[0] as EdgeId))) : [];
}

/** Армии с тем же охватом, что у `army`, по возрастанию id (сама армия входит). */
export function scopeMates(state: MatchState, army: Army): Army[] {
  const dir = army.dir;
  if (!dir) return [];
  const same = blocOf(state, army.owner, dir.target, dir.bloc === true);
  return state.armies
    .filter((a) => {
      if (a.owner !== army.owner || !a.dir || a.dir.mode === 'idle') return false;
      if (a.id === army.id) return true;
      return (
        (dir.bloc === true) === (a.dir.bloc === true) &&
        dir.pocket === a.dir.pocket &&
        same(a.dir.target)
      );
    })
    .sort((a, b) => a.id - b.id);
}

/** Бонус «участок уже у этой армии»: граница не перетекает между армиями при каждом захвате. */
const STICKY = 20;
/** Цена одной грани уже розданного участка в гексах пути: армии нагружаются поровну. */
const LOAD_EDGES_PER_HEX = 4;

// Куски делятся пополам (самый длинный первым), пока их не меньше, чем армий.
function splitPieces(pieces: readonly EdgeId[][], wanted: number): EdgeId[][] {
  const out = pieces.map((p) => [...p]);
  while (out.length < wanted) {
    let longest = 0;
    for (let i = 1; i < out.length; i += 1) {
      if ((out[i] as EdgeId[]).length > (out[longest] as EdgeId[]).length) longest = i;
    }
    const piece = out[longest] as EdgeId[];
    if (piece.length < 2) break;
    const half = piece.length >> 1;
    out.splice(longest, 1, piece.slice(0, half), piece.slice(half));
  }
  return out;
}

// Где армия: гекс её первого отряда, иначе гекс её фронта, иначе -1.
function anchorOf(state: MatchState, army: Army): HexId {
  const unit = allUnits(state).find((u) => u.armyId === army.id);
  if (unit) return unit.hex;
  const plan = state.plans.find((p) => p.armyId === army.id);
  const first = plan?.kind === 'front' ? plan.edges[0] : undefined;
  return first === undefined ? -1 : edgeHex(first);
}

/**
 * Делит куски границы между армиями одного охвата: каждому куску — ближайшая армия, а кому уже
 * принадлежал кусок, тот и остаётся; грузятся армии поровну, у каждой есть хотя бы один участок.
 * Кусков меньше, чем армий, — длинный кусок режется вдоль границы.
 * @returns участки по id армии
 */
export function shareBorder(
  state: MatchState,
  pieces: readonly EdgeId[][],
  mates: readonly Army[],
): Map<number, EdgeId[][]> {
  const result = new Map<number, EdgeId[][]>(mates.map((a) => [a.id, []]));
  const parts = splitPieces(pieces, mates.length);
  const { width } = state.map;
  const had = new Map<number, Set<EdgeId>>();
  const anchors = new Map<number, HexId>();
  for (const a of mates) {
    const plan = state.plans.find((p) => p.armyId === a.id);
    had.set(a.id, new Set(plan?.kind === 'front' ? plan.edges : []));
    anchors.set(a.id, anchorOf(state, a));
  }
  const load = new Map<number, number>(mates.map((a) => [a.id, 0]));
  const order = [...parts].sort(
    (x, y) => y.length - x.length || (x[0] as number) - (y[0] as number),
  );
  for (const part of order) {
    const mid = edgeHex(part[part.length >> 1] as EdgeId);
    let best: Army | undefined;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const a of mates) {
      const at = anchors.get(a.id) ?? -1;
      const far = at < 0 ? 40 : distance(hexFromId(at, width), hexFromId(mid, width));
      const mine = part.filter((e) => had.get(a.id)?.has(e)).length;
      const cost =
        far -
        (mine * 2 >= part.length ? STICKY : 0) +
        intDiv(load.get(a.id) ?? 0, LOAD_EDGES_PER_HEX);
      if (cost < bestCost) {
        bestCost = cost;
        best = a;
      }
    }
    if (!best) continue;
    result.get(best.id)?.push(part);
    load.set(best.id, (load.get(best.id) ?? 0) + part.length);
  }
  // Армии без участка забирают ближайший кусок у самой нагруженной.
  for (const a of mates) {
    if ((result.get(a.id) ?? []).length > 0) continue;
    const donor = [...result].sort((x, y) => y[1].length - x[1].length || x[0] - y[0])[0];
    if (!donor || donor[1].length < 2) continue;
    const at = anchors.get(a.id) ?? -1;
    const index = donor[1].reduce(
      (pick, part, i) => {
        const mid = edgeHex(part[part.length >> 1] as EdgeId);
        const d = at < 0 ? 0 : distance(hexFromId(at, width), hexFromId(mid, width));
        return d < pick.d ? { i, d } : pick;
      },
      { i: 0, d: Number.POSITIVE_INFINITY },
    ).i;
    const [moved] = donor[1].splice(index, 1);
    if (moved) result.set(a.id, [moved]);
  }
  return result;
}

/**
 * Участки границы, которые держит армия направления: вся граница с её охватом, а если охват
 * держат несколько армий — их доля.
 * @returns куски границы — цепочки граней
 */
export function armyPieces(state: MatchState, army: Army): EdgeId[][] {
  const dir = army.dir;
  if (!dir || dir.target < 0) return [];
  const all = borderPieces(state, army.owner, dir.target, dir.bloc === true, dir.pocket);
  const mates = scopeMates(state, army);
  if (mates.length <= 1 || all.length === 0) return all;
  return shareBorder(state, all, mates).get(army.id) ?? [];
}
