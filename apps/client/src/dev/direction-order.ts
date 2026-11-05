// Приказ направления из окна соседа: армия (уже назначенная или новая) и состав по типам войск.
// Числа и армия — один выбор: взяли существующую армию — её состав и правим, новая — заводим заново.
import { FP, type ArmyView, type PlayerView, type UnitType } from '@hexfront/sim';

/** Армия приказа «новая»: sim всегда заводит свежую армию. */
export const NEW_ARMY = -1;

/** Типы войск в порядке показа. */
export const ORDER_TYPES: readonly UnitType[] = ['infantry', 'armor', 'artillery'];

/** Солдат по типам, целые. */
export type Counts = Record<UnitType, number>;

/** Сумма состава, солдат. */
export const totalOf = (counts: Counts): number =>
  counts.infantry + counts.armor + counts.artillery;

/**
 * Состав армии для окна: заказ (лимит и состав), а если лимита нет — то, что стоит в отрядах.
 * @returns солдат по типам
 */
export function armyCounts(view: PlayerView, army: ArmyView): Counts {
  if (army.wanted !== undefined) {
    const armor = army.mix?.armor ?? 0;
    const artillery = army.mix?.artillery ?? 0;
    return { infantry: Math.max(0, army.wanted - armor - artillery), armor, artillery };
  }
  const counts: Counts = { infantry: 0, armor: 0, artillery: 0 };
  for (const u of view.units) {
    if (u.owner === view.playerId && u.armyId === army.id)
      counts[u.type] += Math.floor(u.soldiers / FP);
  }
  return counts;
}

/** Меняет число одного типа; сумма состава не выше предела. */
export function setCount(counts: Counts, type: UnitType, value: number, max: number): Counts {
  const others = totalOf(counts) - counts[type];
  const next = Math.max(
    0,
    Math.min(Math.max(0, max - others), Math.round(Number.isFinite(value) ? value : 0)),
  );
  return { ...counts, [type]: next };
}

/** Поля приказа direction-команды: число, состав и армия (новая или выбранная). */
export function orderFields(
  counts: Counts,
  armyId: number,
): { soldiers: number; armyId: number; mix?: { armor: number; artillery: number } } {
  const mixed = counts.armor + counts.artillery > 0;
  return {
    soldiers: totalOf(counts),
    armyId,
    ...(mixed ? { mix: { armor: counts.armor, artillery: counts.artillery } } : {}),
  };
}
