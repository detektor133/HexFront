// Состав заказа армии по типам (05-armies.md, «Лимит, состав»): лимит делится на пехоту, танки и
// артиллерию; пехота — остаток.
import type { UnitType } from '../balance.ts';
import type { ArmyMix } from './types.ts';

/**
 * Сколько солдат каждого типа заказано.
 * @returns солдат по типам (целые, не fixed-point) или undefined, если состав не задан
 */
export function mixNeed(
  total: number,
  mix: ArmyMix | undefined,
): Record<UnitType, number> | undefined {
  if (mix === undefined) return undefined;
  return {
    infantry: Math.max(0, total - mix.armor - mix.artillery),
    armor: mix.armor,
    artillery: mix.artillery,
  };
}
