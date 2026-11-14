// Сроки дипломатии: запросы помощи без ответа аннулируют пакт, голосования решаются по истечении
// срока, война помощника заканчивается вместе с войной — отряды идут домой.
// GDD: docs/gdd/08-match.md — «Оборонительный пакт и альянс».
import {
  AID_RETURN_TICKS,
  AID_TTL_TICKS,
  ATT_PERIOD_TICKS,
  RESULT_TTL_TICKS,
  VOTE_TTL_TICKS,
} from '../balance.ts';
import { annulAid, returnHome, settle } from '../commands/alliance.ts';
import { driftAttitudes, relationOf } from '../state/relations.ts';
import type { MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

const alive = (state: MatchState, id: number): boolean => state.players[id]?.status === 'alive';

export function diplomacySystem(state: MatchState): void {
  const d = state.diplomacy;
  if (!d) return;
  if (state.tick % ATT_PERIOD_TICKS === 0) driftAttitudes(state);
  for (const call of [...(d.calls ?? [])]) {
    const stale =
      !alive(state, call.ally) ||
      !alive(state, call.victim) ||
      !alive(state, call.aggressor) ||
      relationOf(state, call.victim, call.aggressor) !== 'war';
    if (stale) d.calls = (d.calls ?? []).filter((c) => c !== call);
    else if (state.tick - call.tick >= AID_TTL_TICKS) annulAid(state, call);
  }
  for (const vote of [...(d.votes ?? [])]) {
    settle(state, d, vote, state.tick - vote.tick >= VOTE_TTL_TICKS);
  }
  if (d.locks?.some((l) => l.until <= state.tick)) {
    d.locks = d.locks.filter((l) => l.until > state.tick);
  }
  if (d.results?.some((r) => state.tick - r.tick >= RESULT_TTL_TICKS)) {
    d.results = d.results.filter((r) => state.tick - r.tick < RESULT_TTL_TICKS);
  }
  for (const war of [...(d.aid ?? [])]) {
    const over =
      !alive(state, war.aggressor) ||
      !alive(state, war.victim) ||
      relationOf(state, war.ally, war.aggressor) !== 'war' ||
      relationOf(state, war.ally, war.victim) !== 'defense';
    if (!over) continue;
    // Конец войны: отряды получают путь домой, пока проход по земле союзника ещё открыт.
    if (war.ending === undefined) {
      war.ending = state.tick;
      if (alive(state, war.ally)) returnHome(state, war.ally, war.victim);
      continue;
    }
    const staying = allUnits(state).some(
      (u) => u.owner === war.ally && state.hexes.owner[u.hex] === war.victim,
    );
    if (!staying || state.tick - war.ending >= AID_RETURN_TICKS) {
      d.aid = (d.aid ?? []).filter((w) => w !== war);
    }
  }
}
