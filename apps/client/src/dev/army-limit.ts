// Лимит армии — заказанная численность направления (`wanted`): сколько солдат держать на цели.
// Меняется на карточке армии и в окне соседа одной и той же командой направления.
import { ARMY_LEVEL_DENOMS, FP, type ArmyView, type Command, type PlayerView } from '@hexfront/sim';

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

/** Названия уровней размера армии по возрастанию. */
export const LEVEL_NAMES = [
  'army.level.company',
  'army.level.battalion',
  'army.level.regiment',
  'army.level.division',
  'army.level.corps',
] as const;

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

/**
 * Индекс ближайшего к размеру уровня (−1 — меньше половины роты). Ближайший, а не «не больше»,
 * чтобы название не прыгало, когда предел чуть сдвигается.
 */
export function levelIndex(levels: readonly number[], size: number): number {
  const first = levels[0];
  if (first === undefined || size < first / 2) return -1;
  let best = 0;
  levels.forEach((value, i) => {
    if (Math.abs(value - size) < Math.abs((levels[best] ?? 0) - size)) best = i;
  });
  return best;
}

/** Размер следующего уровня вверх или вниз от ближайшего к текущему; null — выше корпуса или ниже роты. */
export function stepLevel(levels: readonly number[], size: number, dir: 1 | -1): number | null {
  return levels[levelIndex(levels, size) + dir] ?? null;
}
