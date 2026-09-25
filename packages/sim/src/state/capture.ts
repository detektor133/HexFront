// Смена владельца гекса при захвате и её последствия для населения.
// GDD: docs/gdd/02-economy.md — «Население»; 05-armies.md — «Захват».
import { CAPTURE_POP_LOSS_CITY, CAPTURE_POP_LOSS_HEX, ORG_MAX } from '../balance.ts';
import { CAPTURE_RAMP_TICKS } from './city-output.ts';
import { NEUTRAL, type MatchState } from './types.ts';
import type { HexId } from '../math/hex.ts';
import { fpMul, type Fp } from '../math/int.ts';

/**
 * Передаёт гекс (и город на нём) новому владельцу. Захват у игрока уносит
 * CAPTURE_POP_LOSS_HEX населения, в городе — CAPTURE_POP_LOSS_CITY; нейтральный гекс — без потерь.
 */
export function captureHex(state: MatchState, hex: HexId, owner: number): void {
  const { hexes } = state;
  const previous = hexes.owner[hex] ?? NEUTRAL;
  if (previous === owner) return;
  hexes.owner[hex] = owner;
  const city = state.cities.find((c) => c.hex === hex);
  if (city) {
    city.owner = owner;
    // Ополчение захваченного города собирается заново (03-cities-buildings.md).
    city.defenders = 0 as Fp;
    city.defenseOrg = ORG_MAX;
    city.captureTicks = CAPTURE_RAMP_TICKS;
  }
  if (previous === NEUTRAL) return;
  const pop = (hexes.pop[hex] ?? 0) as Fp;
  hexes.pop[hex] = pop - fpMul(pop, city ? CAPTURE_POP_LOSS_CITY : CAPTURE_POP_LOSS_HEX);
}
