// Условия победы: доля городов, последний живой, таймер матча.
// GDD: docs/gdd/08-match.md — «Победа»
import { MATCH_TIME_LIMIT_S, TICKS_PER_S, VICTORY_CITY_SHARE, VICTORY_HOLD_S } from '../balance.ts';
import { FP, intDiv } from '../math/int.ts';
import { playerScore } from '../queries/score.ts';
import type { MatchState, WinReason } from '../state/types.ts';

const HOLD_TICKS = intDiv(VICTORY_HOLD_S * TICKS_PER_S, FP);
const LIMIT_TICKS = intDiv(MATCH_TIME_LIMIT_S * TICKS_PER_S, FP);

function win(state: MatchState, playerId: number, reason: WinReason): void {
  state.winner = playerId;
  state.events.push({ t: 'matchWon', playerId, reason });
}

// Живой игрок с долей городов ≥ VICTORY_CITY_SHARE или -1.
function cityLeader(state: MatchState): number {
  const total = state.cities.length;
  if (total === 0) return -1;
  for (const p of state.players) {
    if (p.status !== 'alive') continue;
    const own = state.cities.filter((c) => c.owner === p.id).length;
    if (own * FP >= VICTORY_CITY_SHARE * total) return p.id;
  }
  return -1;
}

/**
 * Первое выполненное: ≥ 70 % городов VICTORY_HOLD_S подряд; остальные выбыли (при двух и более
 * игроках); таймер MATCH_TIME_LIMIT_S — по очкам, при равенстве — меньший id.
 * Победа фиксируется один раз; остановка матча — забота сервера.
 */
export function victorySystem(state: MatchState): void {
  if (state.winner >= 0) return;
  const alive = state.players.filter((p) => p.status === 'alive');
  const [last] = alive;
  if (state.players.length >= 2 && alive.length === 1 && last)
    return win(state, last.id, 'lastStanding');
  const leader = cityLeader(state);
  if (leader < 0) {
    state.holdPlayer = -1;
    state.holdTicks = 0;
  } else if (leader === state.holdPlayer) state.holdTicks += 1;
  else {
    state.holdPlayer = leader;
    state.holdTicks = 1;
  }
  if (leader >= 0 && state.holdTicks >= HOLD_TICKS) return win(state, leader, 'cities');
  if (state.tick + 1 < LIMIT_TICKS) return;
  let best = -1;
  let bestScore = -1;
  for (const p of alive) {
    const score = playerScore(state, p.id);
    if (score > bestScore) {
      best = p.id;
      bestScore = score;
    }
  }
  if (best >= 0) win(state, best, 'score');
}
