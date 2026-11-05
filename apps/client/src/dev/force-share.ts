// Состав приказа в процентах: три связанных доли (пехота, бронетехника, артиллерия) всегда дают
// 100 %. Казуал выбирает одно число солдат, состав подбирается сам; глубже — тянет доли.
import { COST_GOLD_PER_SOLDIER, FP, type PlayerView } from '@hexfront/sim';

import { ORDER_TYPES, type Counts } from './direction-order.ts';

/** Доли в процентах, целые, в сумме 100. */
export type Shares = Counts;

/** Состав «по умолчанию»: 75 % пехота, 20 % бронетехника, 5 % артиллерия. */
export const DEFAULT_SHARES: Shares = { infantry: 75, armor: 20, artillery: 5 };

/** Двигает долю одного типа; остальные меняются пропорционально, сумма остаётся 100. */
export function setShare(shares: Shares, type: keyof Shares, value: number): Shares {
  const p = Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
  const others = ORDER_TYPES.filter((x) => x !== type);
  const rest = 100 - p;
  const sum = others.reduce((s, x) => s + shares[x], 0);
  const next: Shares = { ...shares, [type]: p };
  let used = 0;
  others.forEach((x, i) => {
    const last = i === others.length - 1;
    const v =
      sum === 0 ? (i === 0 ? rest : 0) : last ? rest - used : Math.round((shares[x] * rest) / sum);
    next[x] = v;
    used += v;
  });
  return next;
}

/** Доли готового состава; пустой состав — по умолчанию. */
export function sharesFromCounts(counts: Counts): Shares {
  const total = counts.infantry + counts.armor + counts.artillery;
  if (total === 0) return DEFAULT_SHARES;
  const armor = Math.round((100 * counts.armor) / total);
  const artillery = Math.min(100 - armor, Math.round((100 * counts.artillery) / total));
  return { infantry: 100 - armor - artillery, armor, artillery };
}

/** Солдаты по типам из общего числа и долей; пехота — остаток после техники. */
export function countsFromShares(total: number, shares: Shares): Counts {
  const armor = Math.round((total * shares.armor) / 100);
  const artillery = Math.min(total - armor, Math.round((total * shares.artillery) / 100));
  return { infantry: total - armor - artillery, armor, artillery };
}

/**
 * Состав по умолчанию под обстановку: 75/20/5, но тип, которого у игрока нет и на который не
 * хватает золота, отдаёт свою долю пехоте — приказ не зависнет в ожидании недоступной закупки.
 */
export function defaultShares(view: PlayerView, total: number): Shares {
  const own: Counts = { infantry: 0, armor: 0, artillery: 0 };
  for (const u of view.units) if (u.owner === view.playerId) own[u.type] += u.soldiers;
  const gold = view.players.find((p) => p.id === view.playerId)?.gold ?? 0;
  const shares = { ...DEFAULT_SHARES };
  for (const type of ['armor', 'artillery'] as const) {
    const needGold = Math.round((total * shares[type]) / 100) * COST_GOLD_PER_SOLDIER[type];
    if (own[type] < FP && gold < needGold) {
      shares.infantry += shares[type];
      shares[type] = 0;
    }
  }
  return shares;
}
