// Ось главного удара направления: ИИ-командир сам выбирает участок границы с целью по обстановке,
// а не по клику игрока (07-controls.md, «Меню страны»). Участок оценивается по трём признакам:
// близость городов и столицы врага, слабость обороны рядом, удобство снабжения со своей стороны.
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';
import { edgeHex, type EdgeId } from '../state/edges.ts';
import type { MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/** Участок удара: грани границы и глубина шага линии наступления. */
export interface Strike {
  readonly edges: EdgeId[];
  readonly depth: number;
}

/** Сколько солдат приходится на одну грань половины ширины удара: больше войск — шире удар. */
const SOLDIERS_PER_EDGE = 100;
const WINDOW_MIN = 2;
const WINDOW_MAX = 12;
const DEPTH = 4;
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

/**
 * Выбирает участок главного удара среди кусков границы с целью.
 * @param pieces куски границы с блоком цели, каждый — цепочка граней
 * @param isEnemy чей гекс считается вражеским (цель и её союзники)
 * @param soldiers заказ солдат: от него зависит ширина удара
 * @returns участок удара; пустой, если границы нет
 */
export function pickAxis(
  state: MatchState,
  owner: number,
  isEnemy: (who: number) => boolean,
  pieces: readonly (readonly EdgeId[])[],
  soldiers: number,
): Strike {
  const { width } = state.map;
  const at = (h: HexId) => hexFromId(h, width);
  const capitals = new Set(state.players.map((p) => p.capitalCityId));
  const objectives = state.cities.filter((c) => isEnemy(c.owner));
  const mine = state.cities.filter((c) => c.owner === owner);
  const units = allUnits(state);
  const score = (edge: EdgeId): number => {
    const p = at(edgeHex(edge));
    let total = 0;
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
  const half = Math.min(WINDOW_MAX, Math.max(WINDOW_MIN, intDiv(soldiers, SOLDIERS_PER_EDGE)));
  let best: { edges: EdgeId[]; value: number } | null = null;
  for (const piece of pieces) {
    const values = piece.map(score);
    for (let i = 0; i < piece.length; i += 1) {
      const from = Math.max(0, i - half);
      const to = Math.min(piece.length, i + half + 1);
      const value = values.slice(from, to).reduce((s, v) => s + v, 0);
      if (!best || value > best.value) best = { edges: piece.slice(from, to), value };
    }
  }
  return { edges: best?.edges ?? [], depth: DEPTH };
}
