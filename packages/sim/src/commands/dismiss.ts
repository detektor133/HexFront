// Роспуск резерва: отряды без армии уходят «в запас» — их солдаты возвращаются в население.
// GDD: docs/gdd/05-armies.md — «Резерв».
import { inBounds, hexFromId, hexId, spiral, type HexId } from '../math/hex.ts';
import { cityPopCap, hexPopCap } from '../state/pop-cap.ts';
import type { MatchState, Unit } from '../state/types.ts';
import { allUnits, removeUnits } from '../state/unit-index.ts';

/** Радиус вокруг отряда, в котором ищется место для вернувшихся людей, гексов. */
const RETURN_RADIUS = 3;

/** Можно ли распустить отряд: свой, в резерве и не в бою. */
export const dismissable = (u: Unit, playerId: number): boolean =>
  u.owner === playerId && u.armyId === null && !u.inBattle;

// Свободное место под людей в гексе: лимит минус нынешнее население; чужие и водные гексы — нет места.
function room(state: MatchState, owner: number, id: HexId): number {
  if (state.hexes.owner[id] !== owner) return 0;
  const city = state.cities.find((c) => c.hex === id);
  const cap = city ? cityPopCap(city.level) : hexPopCap(state, id);
  return Math.max(0, cap - (state.hexes.pop[id] ?? 0));
}

// Возвращает солдат в население ближайших своих гексов; остаток, которому нет места, кладётся в
// свой гекс отряда сверх лимита (он сам уменьшится, как любое население выше лимита).
function giveBack(state: MatchState, unit: Unit): void {
  const { width, height } = state.map;
  let left = unit.soldiers as number;
  let fallback: HexId | null = state.hexes.owner[unit.hex] === unit.owner ? unit.hex : null;
  for (const h of spiral(hexFromId(unit.hex, width), RETURN_RADIUS)) {
    if (left <= 0) return;
    if (!inBounds(h, width, height)) continue;
    const id = hexId(h, width);
    if (state.hexes.owner[id] !== unit.owner) continue;
    fallback ??= id;
    const put = Math.min(left, room(state, unit.owner, id));
    if (put <= 0) continue;
    state.hexes.pop[id] = (state.hexes.pop[id] ?? 0) + put;
    left -= put;
  }
  if (left > 0 && fallback !== null)
    state.hexes.pop[fallback] = (state.hexes.pop[fallback] ?? 0) + left;
}

/**
 * Распускает отряды резерва: отряды исчезают, солдаты возвращаются в население.
 * Чужие, армейские и воюющие отряды пропускаются.
 */
export function dismissUnits(state: MatchState, playerId: number, ids: readonly number[]): void {
  const picked = allUnits(state).filter((u) => ids.includes(u.id) && dismissable(u, playerId));
  for (const unit of picked) giveBack(state, unit);
  removeUnits(state, picked);
}
