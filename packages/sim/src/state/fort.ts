// Укрепления: код постройки → уровень (1–3), 0 — не укрепление. Третий уровень — укрепрайон.
// GDD: docs/gdd/03-cities-buildings.md, «Укрепление».
import { FORT_SPAN } from './building.ts';
import { BUILDING } from './types.ts';

const FORT_CODES = [BUILDING.fort, BUILDING.fort2, BUILDING.fort3] as const;

/** Максимальный уровень укрепления. */
export const FORT_MAX_LEVEL = FORT_CODES.length;

/** Уровень укрепления по коду постройки: 1–3 или 0, если это не укрепление. */
export function fortLevel(building: number): number {
  return building % FORT_SPAN;
}

/** Укрепление ли это (любого уровня). */
export const isFort = (building: number): boolean => fortLevel(building) > 0;

/** Код постройки укрепления заданного уровня 1–3 (выше максимума — максимальный). */
export function fortBuilding(level: number): number {
  return FORT_CODES[Math.min(Math.max(level, 1), FORT_MAX_LEVEL) - 1] ?? BUILDING.fort;
}
