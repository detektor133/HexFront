import { TERRAIN } from '../../../packages/sim/src/map/types.ts';

export interface NeutralHexMetrics {
  readonly neutralHexes: number;
  readonly totalHexes: number;
}

export function shouldContinueMatch(tick: number, winner: number, maxTicks: number): boolean {
  return winner < 0 && tick < maxTicks;
}

export function neutralHexMetrics(
  owners: ArrayLike<number>,
  terrain: ArrayLike<number>,
): NeutralHexMetrics {
  let neutralHexes = 0;
  let totalHexes = 0;
  for (let hex = 0; hex < terrain.length; hex += 1) {
    if (terrain[hex] === TERRAIN.water) continue;
    totalHexes += 1;
    if (owners[hex] === -1) neutralHexes += 1;
  }
  return { neutralHexes, totalHexes };
}
