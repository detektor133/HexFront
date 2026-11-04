// Где стоит фишка в гексе с городом (art/units.md): ниже знака города так, чтобы не закрывать
// звезду столицы (04/T17). Знак растёт с уровнем — сдвиг тоже.
import { tokens } from '../theme/tokens.ts';

/** Высота фишки в её единицах (art/units.md) и масштаб фишки в мире (единиц мира на единицу). */
export const CHIP_H = 26;
export const CHIP_WORLD = 0.55;
/** Экранный размер фишки (в её единицах) ограничен: вблизи не растёт, вдали не мельчает бесконечно. */
const MIN_SCREEN = 0.3;
const MAX_SCREEN = 0.8;
/** Ниже этого экранного размера фишка сворачивается в щит с числом. */
export const COMPACT_BELOW = 0.5;

let world = CHIP_WORLD;

/** Текущий масштаб фишки в мире; зависит от зума камеры (`chipWorldAt`). */
export const chipWorld = (): number => world;

/**
 * Масштаб фишки в мире при масштабе камеры scale: фишка растёт с картой, пока её экранный размер
 * в пределах [MIN_SCREEN, MAX_SCREEN], дальше остаётся постоянной на экране.
 */
export function chipWorldAt(scale: number): number {
  return Math.min(MAX_SCREEN, Math.max(MIN_SCREEN, CHIP_WORLD * scale)) / scale;
}

export function setChipWorld(next: number): void {
  world = next;
}

/** Зазор между звездой и фишкой, единиц мира. */
const GAP = 0.3;

/** Половина высоты фишки с золотой рамкой выбора, единиц мира. */
export const chipHalf = (): number => (CHIP_H / 2 + tokens.selection.width) * world;

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

/**
 * Сдвиг фишки атакующего к цели (units.md, «В бою»): середина между центром своего гекса и
 * серединой общей грани, то есть четверть расстояния до центра соседнего гекса цели.
 * @returns смещение в единицах мира
 */
export function attackShift(from: { x: number; y: number }, to: { x: number; y: number }) {
  return { x: (to.x - from.x) / 4, y: (to.y - from.y) / 4 };
}
