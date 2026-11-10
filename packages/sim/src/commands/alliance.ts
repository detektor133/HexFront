// Альянс и оборонительный пакт (gdd/08-match.md, «Оборонительный пакт и альянс»): голосования
// большинством, запросы помощи, автоматическое вступление в войну, возврат отрядов домой.
import { executeUnitCommand } from './unit.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { groupOf, relationOf, setRelation } from '../state/relations.ts';
import type { AidCall, AllianceVote, Diplomacy, MatchState, Relation } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

const alive = (state: MatchState, id: number): boolean => state.players[id]?.status === 'alive';

/** Связывающие договоры: из них не вступают в войну автоматически. */
const BOUND: readonly Relation[] = ['pact', 'defense', 'alliance'];

/**

 * Война объявлена: члены альянса сторон автоматически воюют друг с другом (пакт с противником
 * этому не мешает), по одному событию `warDeclared` на новую воюющую пару.
 */
export function joinWars(state: MatchState, p: number, target: number): void {
  for (const a of groupOf(state, p)) {
    for (const b of groupOf(state, target)) {
      if (a === b || !alive(state, a) || !alive(state, b)) continue;
      const rel = relationOf(state, a, b);
      // Долг альянса сильнее пакта и оборонительного пакта с противником: они рвутся без нарушения.
      if (rel === 'war' || rel === 'alliance') continue;
      setRelation(state, a, b, 'war');
      state.events.push({ t: 'warDeclared', playerId: a, targetId: b, kind: null });
    }
  }
}

/** Оборонительные партнёры атакованного получают запрос помощи. */
export function requestAid(state: MatchState, aggressor: number, victim: number): void {
  const d = state.diplomacy;
  if (!d) return;
  for (const { id: ally } of state.players) {
    if (ally === aggressor || ally === victim || !alive(state, ally)) continue;
    if (relationOf(state, victim, ally) !== 'defense') continue;
    const rel = relationOf(state, ally, aggressor);
    if (rel === 'war' || BOUND.includes(rel)) continue;
    d.calls ??= [];
    if (d.calls.some((c) => c.ally === ally && c.aggressor === aggressor)) continue;
    d.calls.push({ ally, victim, aggressor, tick: state.tick });
  }
}

/** Отказ от помощи или молчание: оборонительный пакт аннулируется (мир, без нарушения). */
export function annulAid(state: MatchState, call: AidCall): void {
  const d = state.diplomacy;
  if (!d) return;
  d.calls = (d.calls ?? []).filter((c) => c !== call);
  if (relationOf(state, call.ally, call.victim) !== 'defense') return;
  setRelation(state, call.ally, call.victim, 'peace');
  state.events.push({
    t: 'treatyBroken',
    playerId: call.ally,
    targetId: call.victim,
    kind: 'defense',
  });
}

/** Согласие помочь: война с агрессором без нарушения, обзор и проход на время войны. */
export function joinAid(state: MatchState, call: AidCall): void {
  const d = state.diplomacy;
  if (!d) return;
  d.calls = (d.calls ?? []).filter((c) => c !== call);
  d.aid ??= [];
  d.aid.push({ ally: call.ally, victim: call.victim, aggressor: call.aggressor });
  if (relationOf(state, call.ally, call.aggressor) !== 'war') {
    setRelation(state, call.ally, call.aggressor, 'war');
    state.events.push({
      t: 'warDeclared',
      playerId: call.ally,
      targetId: call.aggressor,
      kind: null,
    });
  }
  joinWars(state, call.ally, call.aggressor);
}

function applyVote(state: MatchState, vote: AllianceVote): void {
  const sideA = groupOf(state, vote.a);
  const sideB = groupOf(state, vote.b);
  if (vote.kind === 'join') {
    const all = [...new Set([...sideA, ...sideB])];
    for (const x of all) for (const y of all) if (x < y) setRelation(state, x, y, 'alliance');
    state.events.push({ t: 'treatyMade', playerId: vote.b, targetId: vote.a, kind: 'alliance' });
    return;
  }
  for (const x of sideA) {
    for (const y of sideB) {
      if (relationOf(state, x, y) === 'war') setRelation(state, x, y, 'peace');
    }
  }
  state.events.push({ t: 'treatyMade', playerId: vote.b, targetId: vote.a, kind: 'peace' });
}

/**
 * Решает голосование, если исход ясен: большинство «за» — принято, «за» уже не набрать — отказ.
 * По истечении срока (`expired`) решает набранное: нет большинства — отказ.
 */
export function settle(
  state: MatchState,
  d: Diplomacy,
  vote: AllianceVote,
  expired: boolean,
): void {
  // Общий мир решает каждая сторона со своим альянсом отдельно: враг не голосует за наш мир, а
  // двое договорившихся не перевешивают остальных членов своего альянса.
  const groups = vote.sides ?? [vote.voters];
  let passed = true;
  let lost = false;
  for (const side of groups) {
    const voters = side.filter((v) => alive(state, v) && vote.voters.includes(v));
    if (voters.length === 0) continue;
    const yes = vote.yes.filter((v) => voters.includes(v)).length;
    const no = vote.no.filter((v) => voters.includes(v)).length;
    if (yes * 2 <= voters.length) passed = false;
    if ((voters.length - no) * 2 <= voters.length) lost = true;
  }
  if (!passed && !lost && !expired) return;
  d.votes = (d.votes ?? []).filter((v) => v !== vote);
  if (passed) applyVote(state, vote);
}

/** Открывает голосование; предлагающие и согласившиеся уже проголосовали «за». */
export function openVote(
  state: MatchState,
  kind: AllianceVote['kind'],
  a: number,
  b: number,
  voters: readonly number[],
  sides?: readonly (readonly number[])[],
): void {
  const d = state.diplomacy;
  if (!d) return;
  d.votes ??= [];
  d.nextVote ??= 0;
  const vote: AllianceVote = {
    id: d.nextVote,
    kind,
    a,
    b,
    voters: voters.filter((v) => alive(state, v)),
    ...(sides ? { sides } : {}),
    yes: [a, b].filter((v) => voters.includes(v)),
    no: [],
    tick: state.tick,
  };
  d.nextVote += 1;
  d.votes.push(vote);
  settle(state, d, vote, false);
}

/** Отряды помощника на земле пострадавшего возвращаются на свою территорию. */
export function returnHome(state: MatchState, ally: number, victim: number): void {
  const { width } = state.map;
  const mine: HexId[] = [];
  state.hexes.owner.forEach((o, id) => {
    if (o === ally) mine.push(id);
  });
  if (mine.length === 0) return;
  for (const u of allUnits(state)) {
    if (u.owner !== ally || state.hexes.owner[u.hex] !== victim) continue;
    const from = hexFromId(u.hex, width);
    let best = mine[0] as HexId;
    let bestDist = Infinity;
    for (const id of mine) {
      const dist = distance(from, hexFromId(id, width));
      if (dist < bestDist) {
        best = id;
        bestDist = dist;
      }
    }
    executeUnitCommand(state, ally, { t: 'move', unitIds: [u.id], to: best });
  }
}
