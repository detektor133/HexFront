// Склады: код постройки → уровень склада (1–3), 0 — не склад. Уровень задаёт снабжение склада и
// цену улучшения (docs/gdd/03-cities-buildings.md, «Склад»).
import { BUILDING } from './types.ts';

/** Уровень склада по коду постройки: 1–3 или 0, если это не склад. */
export function depotLevel(building: number): number {
  if (building === BUILDING.depot) return 1;
  if (building === BUILDING.depot2) return 2;
  return building === BUILDING.depot3 ? 3 : 0;
}

/** Склад ли это (любого уровня). */
export const isDepot = (building: number): boolean => depotLevel(building) > 0;

/** Код постройки склада заданного уровня 1–3. */
export function depotBuilding(level: number): number {
  return level >= 3 ? BUILDING.depot3 : level === 2 ? BUILDING.depot2 : BUILDING.depot;
}
