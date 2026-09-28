// Где стоит фишка в гексе с городом (art/units.md): ниже знака города так, чтобы не закрывать
// звезду столицы (04/T17). Знак растёт с уровнем — сдвиг тоже.
import { tokens } from '../theme/tokens.ts';

/** Высота фишки в её единицах (art/units.md) и масштаб фишки в мире (единиц мира на единицу). */
export const CHIP_H = 26;
export const CHIP_WORLD = 0.55;
/** Зазор между звездой и фишкой, единиц мира. */
const GAP = 0.3;

/** Половина высоты фишки с золотой рамкой выбора, единиц мира. */
export const chipHalf = (): number => (CHIP_H / 2 + tokens.selection.width) * CHIP_WORLD;

/** Радиус звезды столицы города уровня level, единиц мира. */
export function starRadius(level: number, radius: number): number {
  const sizes = tokens.city.sizeByLevel;
  const share = sizes[Math.max(0, Math.min(sizes.length - 1, level - 1))] ?? 0;
  return share * radius * tokens.city.capitalStarOuter;
}

/**
 * Сдвиг фишки вниз от центра гекса с городом: верх фишки (с рамкой выбора) — ниже звезды.
 * @returns единиц мира
 */
export function cityChipShift(level: number, radius: number): number {
  return starRadius(level, radius) + GAP + chipHalf();
}
