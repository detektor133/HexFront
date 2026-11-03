// Команды дипломатии (CR-007; gdd/08-match.md, «Дипломатия»): объявление войны (сразу, без
// предупреждения), предложение и принятие пакта или союза, разрыв договора. Договоры — не
// гарантия: их можно нарушить, цена — счётчик нарушений игрока, который видят все.
import { OK, rejected, type Command, type Validation } from './types.ts';
import { OFFER_TTL_TICKS, relationOf, setRelation } from '../state/relations.ts';
import type { MatchState } from '../state/types.ts';

export type DiplomacyCommand = Extract<
  Command,
  { t: 'declareWar' | 'proposeTreaty' | 'answerTreaty' | 'breakTreaty' }
>;

const alive = (state: MatchState, id: number): boolean =>
  Number.isInteger(id) && state.players[id]?.status === 'alive';

function liveOffer(state: MatchState, from: number, to: number) {
  return state.diplomacy?.offers.find(
    (o) => o.from === from && o.to === to && state.tick - o.tick < OFFER_TTL_TICKS,
  );
}

/** Проверяет команду дипломатии без изменения состояния. */
export function validateDiplomacy(
  state: MatchState,
  playerId: number,
  cmd: DiplomacyCommand,
): Validation {
  if (!state.diplomacy) return rejected('badPlayer');
  const other = cmd.t === 'answerTreaty' ? cmd.from : cmd.target;
  if (other === playerId || !alive(state, other)) return rejected('badPlayer');
  const now = relationOf(state, playerId, other);
  switch (cmd.t) {
    case 'declareWar':
      return now === 'war' ? rejected('sameRelation') : OK;
    case 'proposeTreaty':
      if (now === 'alliance' || now === cmd.kind) return rejected('sameRelation');
      // Союз — только с тем, с кем уже мир или пакт; из войны — только пакт (перемирие).
      return now === 'war' && cmd.kind === 'alliance' ? rejected('sameRelation') : OK;
    case 'answerTreaty':
      return liveOffer(state, cmd.from, playerId) ? OK : rejected('noOffer');
    case 'breakTreaty':
      return now === 'pact' || now === 'alliance' ? OK : rejected('sameRelation');
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

/** Применяет команду дипломатии после успешной проверки. */
export function executeDiplomacy(state: MatchState, playerId: number, cmd: DiplomacyCommand): void {
  const d = state.diplomacy;
  if (!d) return;
  switch (cmd.t) {
    case 'declareWar': {
      const now = relationOf(state, playerId, cmd.target);
      const breach = now === 'pact' || now === 'alliance';
      if (breach) d.violations[playerId] = (d.violations[playerId] ?? 0) + 1;
      setRelation(state, playerId, cmd.target, 'war');
      dropOffers(state, playerId, cmd.target);
      state.events.push({
        t: 'warDeclared',
        playerId,
        targetId: cmd.target,
        kind: breach ? (now as 'pact' | 'alliance') : null,
      });
      return;
    }
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
      setRelation(state, cmd.from, playerId, offer.kind);
      cancelAttacks(state, cmd.from, playerId);
      state.events.push({
        t: 'treatyMade',
        playerId,
        targetId: cmd.from,
        kind: offer.kind,
      });
      return;
    }
    case 'breakTreaty': {
      const now = relationOf(state, playerId, cmd.target);
      d.violations[playerId] = (d.violations[playerId] ?? 0) + 1;
      setRelation(state, playerId, cmd.target, 'peace');
      state.events.push({
        t: 'treatyBroken',
        playerId,
        targetId: cmd.target,
        kind: now === 'alliance' ? 'alliance' : 'pact',
      });
      return;
    }
  }
}
