// Оси удара направления: ИИ-командир сам выбирает участки границы с целью по обстановке, а не по
// клику игрока (07-controls.md, «Меню страны»). Участок оценивается по трём признакам: близость
// городов и столицы врага, слабость обороны рядом, удобство снабжения со своей стороны. Осей
// несколько: по одной на каждые AXIS_SOLDIERS солдат заказа, не больше AXIS_MAX.
import { AXIS_MAX, AXIS_SOLDIERS, POCKET_MAX_LAND } from '../balance.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';
import { edgeHex, edgeOther, type EdgeId } from '../state/edges.ts';
import { holeComponents } from '../state/offensive-steps.ts';
import type { MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/** Участок удара: грани границы и глубина шага линии наступления. */
export interface Strike {
  /** Грани границы всех осей подряд: у каждой оси свой участок. */
  readonly edges: EdgeId[];
  /** Участки границы по осям, каждый — отдельный. */
  readonly windows: EdgeId[][];
  /** Сколько осей выбрано. */
  readonly axes: number;
  readonly depth: number;
}

/** Сколько солдат приходится на одну грань половины ширины удара: больше войск — шире удар. */
const SOLDIERS_PER_EDGE = 100;
const WINDOW_MIN = 2;
const WINDOW_MAX = 20;
const DEPTH = 4;
/** Запас между осями вдоль границы, граней: две глубины шага, иначе их линии сомкнутся. */
const AXIS_GAP_EDGES = 4 * DEPTH;
/** Дальность, на которой город врага влияет на оценку участка, гексов. */
const CITY_REACH = 14;
const CAPITAL_WEIGHT = 3;
const CITY_SCALE = 10_000;
/** Радиус, в котором считаются войска у участка, гексов. */
const FORCE_RADIUS = 5;
/** Очков штрафа за вражеского солдата и бонуса за своего у участка. */
const ENEMY_PENALTY = 8;
const OWN_BONUS = 2;
/** Свой город рядом с участком облегчает снабжение. */
const SUPPLY_RADIUS = 6;
const SUPPLY_BONUS = 500;
/** Цена за гекс среднего пути армии до оси: войска бьют рядом с собой, а не идут через всю страну. */
const TRAVEL_COST = 350;
/** Дальше этого пути (гексов) штраф не растёт: иначе далёкая ось навсегда исчезала бы из выбора. */
const TRAVEL_CAP = 24;

/** Где стоят войска, которыми бить: гекс и число солдат (стопки в одном гексе объединены). */
export interface Force {
  readonly hex: HexId;
  readonly soldiers: number;
}

/**
 * Выбирает оси удара среди кусков границы с целью: лучшие по оценке участки, не пересекающиеся.
 * @param pieces куски границы с блоком цели, каждый — цепочка граней
 * @param isEnemy чей гекс считается вражеским (цель и её союзники)
 * @param soldiers заказ солдат: от него зависят число осей и ширина каждой
 * @param skip грани, у которых оси уже есть (новая ось не ближе к ним)
 * @returns оси удара; пустые, если границы нет
 */
export function pickAxes(
  state: MatchState,
  owner: number,
  isEnemy: (who: number) => boolean,
  pieces: readonly (readonly EdgeId[])[],
  soldiers: number,
  skip: readonly EdgeId[] = [],
  want: number = AXIS_MAX,
  forces: readonly Force[] = [],
): Strike {
  const { width } = state.map;
  const at = (h: HexId) => hexFromId(h, width);
  // Котлы — мелкие куски земли врага внутри нашей (или у воды) — удар линией не берёт: их закрывает
  // штурм (assault.ts) группами. Оси выбираются только по настоящему фронту, а не по котлу в тылу,
  // куда иначе тянулась бы вся армия.
  const pockets = new Set<number>(holeComponents(state, owner, POCKET_MAX_LAND).flat());
  const real = pieces.filter((piece) => {
    const first = piece[0];
    return first === undefined || !pockets.has(edgeOther(state, first));
  });
  // Остался один котёл (остаток врага) — бить больше нечем, кроме него.
  const front = real.length > 0 ? real : pieces;
  const capitals = new Set(state.players.map((p) => p.capitalCityId));
  const objectives = state.cities.filter((c) => isEnemy(c.owner));
  const mine = state.cities.filter((c) => c.owner === owner);
  const units = allUnits(state);
  const mass = forces.reduce((sum, f) => sum + f.soldiers, 0);
  const travel = (p: ReturnType<typeof at>): number => {
    if (mass === 0) return 0;
    let sum = 0;
    for (const f of forces) sum += f.soldiers * Math.min(TRAVEL_CAP, distance(p, at(f.hex)));
    return intDiv(sum, mass);
  };
  const score = (edge: EdgeId): number => {
    const p = at(edgeHex(edge));
    let total = -TRAVEL_COST * travel(p);
    for (const c of objectives) {
      const d = distance(p, at(c.hex));
      if (d > CITY_REACH) continue;
      total += (capitals.has(c.id) ? CAPITAL_WEIGHT : 1) * intDiv(CITY_SCALE, d + 2);
    }
    for (const u of units) {
      if (distance(p, at(u.hex)) > FORCE_RADIUS) continue;
      if (isEnemy(u.owner)) total -= ENEMY_PENALTY * intDiv(u.soldiers, FP);
      else if (u.owner === owner) total += OWN_BONUS * intDiv(u.soldiers, FP);
    }
    if (mine.some((c) => distance(p, at(c.hex)) <= SUPPLY_RADIUS)) total += SUPPLY_BONUS;
    return total;
  };
  // Новых осей не нужно (want ≤ 0) — делить заказ на ноль осей нельзя.
  if (want <= 0) return { edges: [], windows: [], axes: 0, depth: DEPTH };
  const count = Math.max(1, Math.min(want, AXIS_MAX, intDiv(soldiers, AXIS_SOLDIERS)));
  const half = Math.min(
    WINDOW_MAX,
    Math.max(WINDOW_MIN, intDiv(intDiv(soldiers, count), SOLDIERS_PER_EDGE)),
  );
  interface Candidate {
    readonly piece: number;
    readonly index: number;
    readonly value: number;
  }
  const candidates: Candidate[] = [];
  front.forEach((piece, p) => {
    const values = piece.map(score);
    for (let i = 0; i < piece.length; i += 1) {
      const from = Math.max(0, i - half);
      const to = Math.min(piece.length, i + half + 1);
      candidates.push({
        piece: p,
        index: i,
        value: values.slice(from, to).reduce((s, v) => s + v, 0),
      });
    }
  });
  candidates.sort((a, b) => b.value - a.value || a.piece - b.piece || a.index - b.index);
  const skipHexes = skip.map((e) => at(edgeHex(e)));
  const near = (c: Candidate): boolean => {
    const here = at(edgeHex(front[c.piece]?.[c.index] as EdgeId));
    return skipHexes.some((h) => distance(h, here) <= half);
  };
  const chosen: Candidate[] = [];
  for (const c of candidates) {
    if (chosen.length >= count) break;
    // Оси не сливаются: глубина шага замыкает линии с боков, поэтому между ними запас по границе.
    const gap = 2 * half + AXIS_GAP_EDGES;
    if (chosen.some((o) => o.piece === c.piece && Math.abs(o.index - c.index) <= gap)) continue;
    if (near(c)) continue;
    chosen.push(c);
  }
  chosen.sort((a, b) => a.piece - b.piece || a.index - b.index);
  const windows = chosen.map((c) =>
    (front[c.piece] ?? []).slice(Math.max(0, c.index - half), c.index + half + 1),
  );
  return { edges: windows.flat(), windows, axes: chosen.length, depth: DEPTH };
}
