// Условия победы: захват всех городов, доля городов с удержанием, последний живой и коалиция
// союзников. Таймера матча нет: пока игра идёт и игрок играет, матч не обрывается.
// GDD: docs/gdd/08-match.md — «Победа»
import { TICKS_PER_S, VICTORY_CITY_SHARE, VICTORY_HOLD_S } from '../balance.ts';
import { FP, intDiv } from '../math/int.ts';
import { isAllied } from '../state/relations.ts';
import type { MatchState, WinReason } from '../state/types.ts';

const HOLD_TICKS = intDiv(VICTORY_HOLD_S * TICKS_PER_S, FP);

function win(
  state: MatchState,
  playerId: number,
  reason: WinReason,
  allies: readonly number[] = [],
): void {
  state.winner = playerId;
  state.events.push({ t: 'matchWon', playerId, reason, ...(allies.length > 0 ? { allies } : {}) });
}

// Игрок и его союзники из живых: коалиция считается вместе (города, победа).
function coalition(state: MatchState, playerId: number): number[] {
  return state.players
    .filter((p) => p.status === 'alive' && (p.id === playerId || isAllied(state, playerId, p.id)))
    .map((p) => p.id);
}

/**
 * Победа по первому выполненному: все остальные выбыли; все живые — союзники друг другу
 * (коалиция); игрок или его коалиция держит все города карты сразу; ≥ 70 % городов
 * VICTORY_HOLD_S подряд. Победа фиксируется один раз; остановка матча — забота сервера.
 */
export function victorySystem(state: MatchState): void {
  if (state.winner >= 0 || state.noVictory === true) return;
  const alive = state.players.filter((p) => p.status === 'alive');
  const [first] = alive;
  if (state.players.length >= 2 && alive.length === 1 && first) {
    return win(state, first.id, 'lastStanding');
  }
  if (
    first &&
    alive.length >= 2 &&
    alive.every((a, i) => alive.slice(i + 1).every((b) => isAllied(state, a.id, b.id)))
  ) {
    return win(
      state,
      first.id,
      'coalition',
      alive.map((p) => p.id),
    );
  }
  const total = state.cities.length;
  let leader = -1;
  let group: number[] = [];
  if (total > 0) {
    for (const p of alive) {
      const members = coalition(state, p.id);
      const own = state.cities.filter((c) => members.includes(c.owner)).length;
      if (own === total) return win(state, p.id, 'allCities', members);
      if (leader < 0 && own * FP >= VICTORY_CITY_SHARE * total) {
        leader = p.id;
        group = members;
      }
    }
  }
  if (leader < 0) {
    state.holdPlayer = -1;
    state.holdTicks = 0;
  } else if (leader === state.holdPlayer) state.holdTicks = Math.max(0, state.holdTicks - 1);
  else {
    state.holdPlayer = leader;
    state.holdTicks = Math.max(0, HOLD_TICKS - 1);
  }
  if (leader >= 0 && state.holdTicks === 0) win(state, leader, 'cities', group);
}
