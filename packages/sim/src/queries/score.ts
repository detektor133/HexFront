// Очки и место игрока. GDD: docs/gdd/08-match.md — «Победа» (п. 3), «Очки и места».
import { SCORE_CITY, SCORE_HEX, SCORE_PER_100_SOLDIERS } from '../balance.ts';
import { FP, intDiv } from '../math/int.ts';
import type { MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

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
  const soldiers = allUnits(state)
    .filter((a) => a.owner === playerId)
    .reduce((sum, a) => sum + a.soldiers, 0);
  return (
    SCORE_CITY * cities +
    SCORE_HEX * hexes +
    SCORE_PER_100_SOLDIERS * intDiv(soldiers, SOLDIERS_PER_SCORE * FP)
  );
}

/**
 * Очки всех игроков одним проходом по гексам и отрядам — то же, что playerScore по каждому.
 * @returns целые очки по id игрока
 */
export function playerScores(state: MatchState): Int32Array {
  const n = state.players.length;
  const cities = new Int32Array(n);
  const hexes = new Int32Array(n);
  const soldiers = new Array<number>(n).fill(0);
  for (const c of state.cities) {
    if (c.owner >= 0 && c.owner < n) cities[c.owner] = (cities[c.owner] ?? 0) + 1;
  }
  for (const o of state.hexes.owner) if (o >= 0 && o < n) hexes[o] = (hexes[o] ?? 0) + 1;
  for (const u of state.units) {
    if (u.owner >= 0 && u.owner < n) soldiers[u.owner] = (soldiers[u.owner] ?? 0) + u.soldiers;
  }
  return Int32Array.from(
    { length: n },
    (_, p) =>
      SCORE_CITY * (cities[p] ?? 0) +
      SCORE_HEX * (hexes[p] ?? 0) +
      SCORE_PER_100_SOLDIERS * intDiv(soldiers[p] ?? 0, SOLDIERS_PER_SCORE * FP),
  );
}

/**
 * Место игрока: живые — по очкам (1 + число живых с большим счётом); выбывшие — после всех
 * живых, по порядку выбывания: выбывший позже стоит выше, в одном тике — меньший id выше.
 * @returns место (1 — лидер)
 */
export function playerPlace(state: MatchState, playerId: number): number {
  const me = state.players[playerId];
  const alive = state.players.filter((p) => p.status === 'alive');
  if (me?.status === 'eliminated') {
    const above = state.players.filter(
      (p) =>
        p.status === 'eliminated' &&
        (p.eliminatedTick > me.eliminatedTick ||
          (p.eliminatedTick === me.eliminatedTick && p.id < me.id)),
    ).length;
    return alive.length + above + 1;
  }
  const scores = playerScores(state);
  const mine = scores[playerId] ?? 0;
  return 1 + alive.filter((p) => (scores[p.id] ?? 0) > mine).length;
}
