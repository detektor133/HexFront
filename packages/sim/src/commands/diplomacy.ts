// Команды дипломатии (CR-007; gdd/08-match.md, «Дипломатия»): объявление войны (сразу, без
// предупреждения), предложение и принятие договора, разрыв договора, ответ на запрос помощи
// оборонительного пакта и голос в альянсе. Договоры — не гарантия: их можно нарушить, цена —
// счётчик нарушений игрока, который видят все.
import {
  annulAid,
  endAid,
  joinAid,
  joinAllianceWars,
  joinWars,
  openVote,
  requestAid,
  settle,
  voteBlocked,
} from './alliance.ts';
import { OK, rejected, type Command, type Validation } from './types.ts';
import { AID_TTL_TICKS } from '../balance.ts';
import {
  OFFER_TTL_TICKS,
  allianceOf,
  groupOf,
  recordBreach,
  recordTreaty,
  recordWar,
  relationOf,
  setRelation,
} from '../state/relations.ts';
import type { MatchState, TreatyKind } from '../state/types.ts';

export type DiplomacyCommand = Extract<
  Command,
  {
    t:
      | 'declareWar'
      | 'proposeTreaty'
      | 'answerTreaty'
      | 'breakTreaty'
      | 'answerAid'
      | 'proposeExpel'
      | 'castVote';
  }
>;

const alive = (state: MatchState, id: number): boolean =>
  Number.isInteger(id) && state.players[id]?.status === 'alive';

function liveOffer(state: MatchState, from: number, to: number) {
  return state.diplomacy?.offers.find(
    (o) => o.from === from && o.to === to && state.tick - o.tick < OFFER_TTL_TICKS,
  );
}

const liveCall = (state: MatchState, ally: number, aggressor: number) =>
  state.diplomacy?.calls?.find(
    (c) => c.ally === ally && c.aggressor === aggressor && state.tick - c.tick < AID_TTL_TICKS,
  );

/** Ступени договора: новый можно заключить только выше нынешнего, вниз — разрывом. */
const RANK = { peace: 0, pact: 1, defense: 2, alliance: 3 } as const;

/** Проверяет команду дипломатии без изменения состояния. */
export function validateDiplomacy(
  state: MatchState,
  playerId: number,
  cmd: DiplomacyCommand,
): Validation {
  if (!state.diplomacy) return rejected('badPlayer');
  if (cmd.t === 'answerAid') {
    return liveCall(state, playerId, cmd.aggressor) ? OK : rejected('noOffer');
  }
  if (cmd.t === 'proposeExpel') {
    // Исключать можно члена своего альянса, если в нём не меньше троих: иначе это просто выход.
    const group = groupOf(state, playerId);
    const open = voteBlocked(state, 'kick', playerId, cmd.target);
    if (!Number.isInteger(cmd.target) || cmd.target === playerId || !alive(state, cmd.target)) {
      return rejected('badPlayer');
    }
    if (relationOf(state, playerId, cmd.target) !== 'alliance' || group.length < 3) {
      return rejected('sameRelation');
    }
    return open ? rejected('sameRelation') : OK;
  }
  if (cmd.t === 'castVote') {
    const vote = state.diplomacy.votes?.find((v) => v.id === cmd.voteId);
    const open = vote?.voters.includes(playerId) && ![...vote.yes, ...vote.no].includes(playerId);
    return open ? OK : rejected('noOffer');
  }
  const other = cmd.t === 'answerTreaty' ? cmd.from : cmd.target;
  if (other === playerId || !alive(state, other)) return rejected('badPlayer');
  const now = relationOf(state, playerId, other);
  switch (cmd.t) {
    case 'declareWar':
      return now === 'war' ? rejected('sameRelation') : OK;
    case 'proposeTreaty':
      // Из войны — только мир; из мира и договоров — только более тесный договор.
      if (now === 'war') {
        if (cmd.kind !== 'peace') return rejected('sameRelation');
        return voteBlocked(state, 'peace', playerId, other) ? rejected('sameRelation') : OK;
      }
      if (cmd.kind === 'peace') return rejected('sameRelation');
      if (cmd.kind === 'alliance' && voteBlocked(state, 'join', playerId, other)) {
        return rejected('sameRelation');
      }
      return RANK[cmd.kind] > RANK[now] ? OK : rejected('sameRelation');
    case 'answerTreaty':
      return liveOffer(state, cmd.from, playerId) ? OK : rejected('noOffer');
    case 'breakTreaty':
      return now === 'pact' || now === 'defense' || now === 'alliance'
        ? OK
        : rejected('sameRelation');
  }
}

// Договор заключён: атаки друг на друга, начатые в войне, снимаются.
function cancelAttacks(state: MatchState, a: number, b: number): void {
  for (const u of state.units) {
    if (u.order !== 'attack' || (u.owner !== a && u.owner !== b)) continue;
    const other = u.owner === a ? b : a;
    const hostile =
      state.hexes.owner[u.target] === other ||
      state.units.some((x) => x.owner === other && x.hex === u.target);
    if (!hostile) continue;
    u.order = 'idle';
    u.target = -1;
    u.path = [];
    u.moveTicks = 0;
    u.moveTotal = 0;
  }
}

function dropOffers(state: MatchState, a: number, b: number): void {
  const d = state.diplomacy;
  if (!d) return;
  d.offers = d.offers.filter(
    (o) => !((o.from === a && o.to === b) || (o.from === b && o.to === a)),
  );
}

// Предатель: объявил войну члену своего альянса — все члены альянса воюют с ним, нарушение +1.
function betray(state: MatchState, traitor: number): void {
  for (const member of allianceOf(state, traitor)) {
    setRelation(state, traitor, member, 'war');
    recordWar(state, traitor, member);
    state.events.push({ t: 'warDeclared', playerId: traitor, targetId: member, kind: 'alliance' });
  }
}

function declareWar(state: MatchState, playerId: number, target: number): void {
  const d = state.diplomacy;
  if (!d) return;
  const now = relationOf(state, playerId, target);
  const breach = now === 'pact' || now === 'defense' || now === 'alliance';
  if (breach) {
    d.violations[playerId] = (d.violations[playerId] ?? 0) + 1;
    recordBreach(state, playerId);
  }
  dropOffers(state, playerId, target);
  if (now === 'alliance') {
    betray(state, playerId);
    return;
  }
  setRelation(state, playerId, target, 'war');
  recordWar(state, playerId, target);
  state.events.push({
    t: 'warDeclared',
    playerId,
    targetId: target,
    kind: breach ? (now as Exclude<TreatyKind, 'peace'>) : null,
  });
  // Война одному члену альянса — война всем; оборонительные партнёры атакованного получают запрос.
  joinWars(state, playerId, target);
  requestAid(state, playerId, target);
}

// Договор принят адресатом. Альянс и мир, где у стороны есть альянс, решает голосование.
function conclude(state: MatchState, from: number, to: number, kind: TreatyKind): void {
  const sideFrom = groupOf(state, from);
  const sideTo = groupOf(state, to);
  const single = sideFrom.length === 1 && sideTo.length === 1;
  if (kind === 'alliance' && !single) {
    // Новичок без альянса сам не голосует: решают те, кто уже в альянсах.
    const voters =
      sideFrom.length === 1 ? sideTo : sideTo.length === 1 ? sideFrom : [...sideFrom, ...sideTo];
    voters.sort((x, y) => x - y);
    openVote(state, 'join', from, to, voters);
    return;
  }
  if (kind === 'peace' && !single) {
    // Каждая сторона с альянсом голосует за мир сама: ответ адресата не решает за его альянс.
    openVote(
      state,
      'peace',
      from,
      to,
      [...new Set([...sideFrom, ...sideTo])].sort((x, y) => x - y),
      [sideFrom, sideTo],
    );
    return;
  }
  setRelation(state, from, to, kind);
  recordTreaty(state, from, to, kind);
  cancelAttacks(state, from, to);
  state.events.push({ t: 'treatyMade', playerId: to, targetId: from, kind });
  if (kind === 'alliance') joinAllianceWars(state, [from, to]);
  if (kind === 'peace') {
    endAid(state, [from], [to]);
    endAid(state, [to], [from]);
  }
}

// Выход из альянса целиком: мир со всеми членами, нарушение +1.
function leaveAlliance(state: MatchState, playerId: number): void {
  for (const member of allianceOf(state, playerId)) setRelation(state, playerId, member, 'peace');
}

/** Применяет команду дипломатии после успешной проверки. */
export function executeDiplomacy(state: MatchState, playerId: number, cmd: DiplomacyCommand): void {
  const d = state.diplomacy;
  if (!d) return;
  switch (cmd.t) {
    case 'declareWar':
      declareWar(state, playerId, cmd.target);
      return;
    case 'proposeTreaty':
      dropOffers(state, playerId, cmd.target);
      d.offers.push({ from: playerId, to: cmd.target, kind: cmd.kind, tick: state.tick });
      state.events.push({
        t: 'treatyOffered',
        playerId,
        targetId: cmd.target,
        kind: cmd.kind,
      });
      return;
    case 'answerTreaty': {
      const offer = liveOffer(state, cmd.from, playerId);
      dropOffers(state, cmd.from, playerId);
      if (!offer || !cmd.accept) return;
      conclude(state, cmd.from, playerId, offer.kind);
      return;
    }
    case 'breakTreaty': {
      const now = relationOf(state, playerId, cmd.target);
      d.violations[playerId] = (d.violations[playerId] ?? 0) + 1;
      recordBreach(state, playerId);
      if (now === 'alliance') leaveAlliance(state, playerId);
      else setRelation(state, playerId, cmd.target, 'peace');
      state.events.push({
        t: 'treatyBroken',
        playerId,
        targetId: cmd.target,
        kind: now === 'alliance' ? 'alliance' : now === 'defense' ? 'defense' : 'pact',
      });
      return;
    }
    case 'answerAid': {
      const call = liveCall(state, playerId, cmd.aggressor);
      if (!call) return;
      if (cmd.join) joinAid(state, call);
      else annulAid(state, call);
      return;
    }
    case 'proposeExpel': {
      const voters = groupOf(state, playerId).filter((id) => id !== cmd.target);
      openVote(state, 'kick', playerId, cmd.target, voters);
      return;
    }
    case 'castVote': {
      const vote = d.votes?.find((v) => v.id === cmd.voteId);
      if (!vote) return;
      (cmd.yes ? vote.yes : vote.no).push(playerId);
      settle(state, d, vote, false);
      return;
    }
  }
}
