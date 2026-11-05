// Склады: код постройки → уровень склада (1–5), 0 — не склад. Уровень задаёт снабжение склада и
// цену улучшения (docs/gdd/03-cities-buildings.md, «Склад»).
import { FORT_SPAN } from './building.ts';
import { BUILDING } from './types.ts';
import { intDiv } from '../math/int.ts';

/** Уровень склада по коду постройки (4 × уровень + уровень укрепления): 1–5 или 0, если склада нет. */
export function depotLevel(building: number): number {
  return Math.min(DEPOT_MAX_LEVEL, intDiv(building, FORT_SPAN));
}

/** Склад ли это (любого уровня). */
export const isDepot = (building: number): boolean => depotLevel(building) > 0;

const DEPOT_CODES = [
  BUILDING.depot,
  BUILDING.depot2,
  BUILDING.depot3,
  BUILDING.depot4,
  BUILDING.depot5,
] as const;

/** Максимальный уровень склада. */
export const DEPOT_MAX_LEVEL = DEPOT_CODES.length;

/** Код постройки склада заданного уровня 1–5 (выше максимума — максимальный). */
export function depotBuilding(level: number): number {
  return DEPOT_CODES[Math.min(Math.max(level, 1), DEPOT_MAX_LEVEL) - 1] ?? BUILDING.depot;
}
