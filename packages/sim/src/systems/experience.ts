// Опыт армии: растёт от боёв, звёзды дают бонусы силы, организации и скорости восполнения потерь.
// GDD: docs/gdd/05-armies.md — «Размер, опыт и разделение армии».
import { STAR_ORG_PCT, STAR_POWER_PCT, STAR_REPLENISH_PCT, XP_STAR_TICKS } from '../balance.ts';
import type { MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/**
 * Звёзды по опыту армии.
 * @param xp опыт, тиков боя
 * @returns 0…3
 */
export function starsOf(xp: number): number {
  return XP_STAR_TICKS.filter((need) => xp >= need).length;
}

/** Бонус звёзд из таблицы в процентах; 0 звёзд — 0. */
function pct(table: readonly number[], stars: number | undefined): number {
  return stars === undefined || stars <= 0 ? 0 : (table[Math.min(stars, table.length) - 1] ?? 0);
}

/** @returns бонус силы в бою, % */
export const powerPct = (stars: number | undefined): number => pct(STAR_POWER_PCT, stars);
/** @returns бонус организации (регенерация и меньшие потери), % */
export const orgPct = (stars: number | undefined): number => pct(STAR_ORG_PCT, stars);
/** @returns бонус скорости восполнения потерь, % */
export const replenishPct = (stars: number | undefined): number => pct(STAR_REPLENISH_PCT, stars);

/**
 * Армия с отрядом в бою получает тик опыта; звёзды опыта армии раздаются всем её отрядам, так что
 * новобранцы и прикреплённые отряды воюют с опытом армии.
 */
export function experienceSystem(state: MatchState): void {
  const fighting = new Set<number>();
  for (const u of allUnits(state)) if (u.inBattle && u.armyId !== null) fighting.add(u.armyId);
  const stars = new Map<number, number>();
  for (const army of state.armies) {
    if (fighting.has(army.id)) army.xp = (army.xp ?? 0) + 1;
    stars.set(army.id, starsOf(army.xp ?? 0));
  }
  for (const u of allUnits(state)) u.stars = u.armyId === null ? 0 : (stars.get(u.armyId) ?? 0);
}
