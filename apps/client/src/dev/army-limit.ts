// Лимит армии — заказанная численность направления (`wanted`): сколько солдат держать на цели.
// Меняется на карточке армии и в окне соседа одной и той же командой направления.
import { ARMY_LEVEL_DENOMS, FP, type ArmyView, type Command, type PlayerView } from '@hexfront/sim';

/** Шаг кнопок −/+ лимита, солдат. */
export const LIMIT_STEP = 10;

/**
 * Предел лимита: солдаты в отрядах плюс половина населения — недостающих ИИ закупит и подведёт.
 * @returns солдат, не меньше 1
 */
export function maxArmySoldiers(view: PlayerView): number {
  const total = view.units
    .filter((unit) => unit.owner === view.playerId)
    .reduce((sum, unit) => sum + unit.soldiers, 0);
  return Math.max(1, Math.floor((total + view.me.popTotal / 2) / FP));
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

/** Индекс уровня, не превышающего размер (−1 — меньше роты). */
export function levelIndex(levels: readonly number[], size: number): number {
  let index = -1;
  levels.forEach((value, i) => {
    if (value <= size) index = i;
  });
  return index;
}

/** Следующий размер по уровням вверх или вниз от текущего; null — выше корпуса или ниже роты. */
export function stepLevel(levels: readonly number[], size: number, dir: 1 | -1): number | null {
  const next =
    dir === 1 ? levels.find((value) => value > size) : [...levels].reverse().find((v) => v < size);
  return next ?? null;
}
