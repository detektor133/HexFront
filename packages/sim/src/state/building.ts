// Код постройки гекса: на гексе могут стоять и укрепление, и склад. Код = 4 × уровень склада
// (0–5) + уровень укрепления (0–3), поэтому одно поле хранит обе постройки.
import { intDiv } from '../math/int.ts';

/** Сколько кодов занимает уровень укрепления (0–3): шаг уровня склада. */
export const FORT_SPAN = 4;

const clamp = (level: number, max: number): number => Math.max(0, Math.min(max, level));

/** Код с заменённым уровнем склада; укрепление на гексе не трогается. */
export function withDepot(building: number, level: number): number {
  return (building % FORT_SPAN) + clamp(level, 5) * FORT_SPAN;
}

/** Код с заменённым уровнем укрепления; склад на гексе не трогается. */
export function withFort(building: number, level: number): number {
  return intDiv(building, FORT_SPAN) * FORT_SPAN + clamp(level, 3);
}
