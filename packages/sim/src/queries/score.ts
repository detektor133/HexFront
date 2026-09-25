// Очки и место игрока. GDD: docs/gdd/08-match.md — «Победа» (п. 3), «Очки и места».
import { SCORE_CITY, SCORE_HEX, SCORE_PER_100_SOLDIERS } from '../balance.ts';
import { FP, intDiv } from '../math/int.ts';
import type { MatchState } from '../state/types.ts';

/** Солдат на одно очко за войска. */
const SOLDIERS_PER_SCORE = 100;

/**
 * Очки: города × 10 + гексы × 1 + солдаты / 100.
 * @returns целые очки
 */
export function playerScore(state: MatchState, playerId: number): number {
  const cities = state.cities.filter((c) => c.owner === playerId).length;
  let hexes = 0;
  state.hexes.owner.forEach((o) => {
    if (o === playerId) hexes += 1;
  });
  const soldiers = state.units
    .filter((a) => a.owner === playerId)
    .reduce((sum, a) => sum + a.soldiers, 0);
  return (
    SCORE_CITY * cities +
    SCORE_HEX * hexes +
    SCORE_PER_100_SOLDIERS * intDiv(soldiers, SOLDIERS_PER_SCORE * FP)
  );
}

/**
 * Место живого игрока по очкам: 1 + число живых игроков с большим счётом.
 * @returns место (1 — лидер)
 */
export function playerPlace(state: MatchState, playerId: number): number {
  const mine = playerScore(state, playerId);
  return (
    1 + state.players.filter((p) => p.status === 'alive' && playerScore(state, p.id) > mine).length
  );
}
