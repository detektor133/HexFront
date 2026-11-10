// Лимит армии — заказанная численность направления (`wanted`): сколько солдат держать на цели.
// Меняется на карточке армии и в окне соседа одной и той же командой направления.
import {
  ARMY_LEVEL_DENOMS,
  COST_GOLD_PER_SOLDIER,
  FP,
  type ArmyView,
  type Command,
  type PlayerView,
  type UnitType,
} from '@hexfront/sim';

/** Шаг кнопок −/+ лимита, солдат. */
export const LIMIT_STEP = 10;

/**
 * Предел лимита и основа уровней армии: половина суммы солдат и людей. Набор переводит людей в
 * солдат один к одному, поэтому сумма не прыгает, когда армия растёт, и названия уровней стоят на месте.
 * @returns солдат, не меньше 1
 */
export function maxArmySoldiers(view: PlayerView): number {
  const total = view.units
    .filter((unit) => unit.owner === view.playerId)
    .reduce((sum, unit) => sum + unit.soldiers, 0);
  return Math.max(1, Math.floor((total + view.me.popTotal) / (2 * FP)));
}

/** Доля предела, округлённая до целых солдат. */
export function presetAmount(max: number, share: number): number {
  return Math.max(1, Math.round(max * share));
}

/** Ограничивает значение лимита пределом 0..max. */
export function clampLimit(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(Number.isFinite(value) ? value : 0)));
}

/** Команда нового лимита любой армии: направление и режим не трогаются, ИИ добирает до числа. */
export function limitCommand(
  army: ArmyView,
  soldiers: number,
  mix?: { readonly armor: number; readonly artillery: number },
): Command {
  return { t: 'setArmyLimit', armyId: army.id, soldiers, ...(mix ? { mix } : {}) };
}

/**
 * Сколько и за сколько придётся нанять, чтобы армия стала такой, как заказано. Считает так же, как
 * закупка в симуляции: типы по порядку, всего не больше разницы до лимита, поэтому излишек одного
 * типа не вычитается из недобора другого.
 * @returns солдат к найму и золота, целые числа
 */
export function hireEstimate(
  have: Record<UnitType, number>,
  want: Record<UnitType, number>,
): { readonly soldiers: number; readonly gold: number } {
  const owned = have.infantry + have.armor + have.artillery;
  let room = Math.max(0, want.infantry + want.armor + want.artillery - owned);
  let soldiers = 0;
  let gold = 0;
  for (const type of ['infantry', 'armor', 'artillery'] as const) {
    const amount = Math.min(room, Math.max(0, want[type] - have[type]));
    room -= amount;
    soldiers += amount;
    gold += (amount * COST_GOLD_PER_SOLDIER[type]) / FP;
  }
  return { soldiers, gold: Math.round(gold) };
}

/** Солдаты армии по типам: те, что уже стоят в отрядах. */
export function onHand(view: PlayerView, army: ArmyView): Record<UnitType, number> {
  const counts = { infantry: 0, armor: 0, artillery: 0 };
  for (const u of view.units) {
    if (u.owner === view.playerId && u.armyId === army.id) counts[u.type] += u.soldiers / FP;
  }
  return counts;
}

/**
 * Размеры уровней армии, солдат: доля предела государства (ARMY_LEVEL_DENOMS), строго по
 * возрастанию — на малых картах совпавшие уровни сливаются.
 */
export function armyLevels(max: number): readonly number[] {
  const sizes: number[] = [];
  for (const denom of ARMY_LEVEL_DENOMS) {
    const size = Math.max(1, Math.round(max / denom));
    if (sizes.length === 0 || size > (sizes.at(-1) ?? 0)) sizes.push(size);
  }
  return sizes;
}

/** Размер армии для уровней: заказ (предел), а без заказа — солдаты в отрядах. */
export function armySize(army: ArmyView, soldiers: number): number {
  return army.wanted ?? soldiers;
}

/** Первый «плюс» армии с нулевым лимитом даёт столько солдат. */
export const FIRST_STEP_SOLDIERS = 200;

/** Варианты шага «+/−» в процентах от текущего размера армии. */
export const STEP_CHOICES = [10, 25, 50, 100] as const;
export type StepPct = (typeof STEP_CHOICES)[number];
export const DEFAULT_STEP: StepPct = 25;

/**
 * Размер армии после шага «усилить» или «уменьшить» на долю текущего размера: шаг растёт вместе с
 * армией, хардкода числа нет. Не меньше одного солдата и не больше предела.
 * @returns солдат; равен size, если шаг невозможен
 */
export function stepSize(size: number, pct: number, dir: 1 | -1, max: number): number {
  // Армия без лимита сразу получает осмысленный размер: шаги 1, 2, 4 солдата — это очень долго.
  if (dir === 1 && size <= 0) return Math.min(max, FIRST_STEP_SOLDIERS);
  const delta = Math.max(1, Math.ceil((size * pct) / 100));
  return dir === 1 ? Math.min(max, size + delta) : Math.max(1, size - delta);
}
