// Дипломатия ботов (CR-007; gdd/09-bots.md): решения по тем же признакам, что у остальных ботов —
// сила игроков (очки матча, они публичны), контакт границ и счётчик нарушений. Порогов «в коде»
// нет: сравниваются отношения сил в fixed-point (1,0 = равенство). Бот видит только то, что видел
// бы игрок: соседей — по границе своих гексов.
import type { BotTickContext } from './context.ts';
import { BOT_EASY_THINK_TICKS, BOT_WAR_GRACE_TICKS } from '../balance.ts';
import type { Command } from '../commands/types.ts';
import { hexFromId, hexId, inBounds, neighbors } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';
import { seaTargets } from '../queries/sea-route.ts';
import { isPortOf } from '../state/port.ts';
import { OFFER_TTL_TICKS, relationOf } from '../state/relations.ts';
import type { MatchState } from '../state/types.ts';

/** Период, в котором бот может сделать предложения: два срока жизни предложения. */
const PROPOSE_PERIOD_TICKS = OFFER_TTL_TICKS * 2;

interface Rival {
  readonly id: number;
  /** Сколько своих пограничных гексов касается этого игрока. */
  readonly contact: number;
  /** Моя сила к его силе, fixed-point: ≥ FP — я не слабее. */
  readonly opportunity: number;
  /** Его сила к моей, fixed-point: ≥ FP — он не слабее. */
  readonly threat: number;
}

/** Как часто бот ищет соперников за морем, тиков: поиск по воде дороже поиска по границе. */
const OVERSEAS_PERIOD_TICKS = 600;

// Игроки за морем: чья земля у воды досягаема из портов бота. Только раз в OVERSEAS_PERIOD_TICKS.
function overseas(
  state: MatchState,
  me: number,
  context: BotTickContext,
  known: ReadonlySet<number>,
) {
  if (state.tick % OVERSEAS_PERIOD_TICKS !== me % OVERSEAS_PERIOD_TICKS) return [];
  const found = new Map<number, number>();
  const g = { map: state.map, hexes: state.hexes, cities: state.cities };
  for (const hex of context.ownedHexes[me] ?? []) {
    if (!isPortOf(g, me, hex)) continue;
    for (const target of seaTargets(state.map, hex).keys()) {
      const owner = state.hexes.owner[target] ?? -1;
      if (owner >= 0 && owner !== me && !known.has(owner))
        found.set(owner, (found.get(owner) ?? 0) + 1);
    }
  }
  const scores = context.playerView.scores;
  const mine = (scores[me] ?? 0) + 1;
  return [...found]
    .filter(([id]) => state.players[id]?.status === 'alive')
    .map(([id, count]) => {
      const theirs = (scores[id] ?? 0) + 1;
      return {
        id,
        contact: count,
        opportunity: intDiv(mine * FP, theirs),
        threat: intDiv(theirs * FP, mine),
      };
    })
    .sort((a, b) => a.id - b.id);
}

function rivals(state: MatchState, me: number, context: BotTickContext): Rival[] {
  const contact = new Map<number, number>();
  const { width, height } = state.map;
  for (const hex of context.borderHexes[me] ?? []) {
    const touched = new Set<number>();
    for (const n of neighbors(hexFromId(hex, width))) {
      if (!inBounds(n, width, height)) continue;
      const owner = state.hexes.owner[hexId(n, width)] ?? -1;
      if (owner >= 0 && owner !== me) touched.add(owner);
    }
    for (const o of touched) contact.set(o, (contact.get(o) ?? 0) + 1);
  }
  const scores = context.playerView.scores;
  const mine = (scores[me] ?? 0) + 1;
  return [...contact]
    .filter(([id]) => state.players[id]?.status === 'alive')
    .map(([id, count]) => {
      const theirs = (scores[id] ?? 0) + 1;
      return {
        id,
        contact: count,
        opportunity: intDiv(mine * FP, theirs),
        threat: intDiv(theirs * FP, mine),
      };
    })
    .sort((a, b) => a.id - b.id);
}

/**
 * Решения бота me по договорам и войне на этот тик.
 * @returns команды дипломатии (в порядке: ответы на предложения, война, новые предложения)
 */
export function diplomacyCommands(
  state: MatchState,
  me: number,
  context: BotTickContext,
): Command[] {
  const d = state.diplomacy;
  if (!d) return [];
  const out: Command[] = [];
  const land = rivals(state, me, context);
  const all = [...land, ...overseas(state, me, context, new Set(land.map((r) => r.id)))];
  const myViolations = d.violations[me] ?? 0;
  const atWarNow = all.filter((r) => relationOf(state, me, r.id) === 'war');
  const worstThreat = (except: number): number =>
    Math.max(0, ...all.filter((r) => r.id !== except).map((r) => r.threat));

  // Ответы: договор берётся, когда сильный сосед рядом опаснее, чем выгода напасть на предлагающего,
  // и предлагающий не злостный нарушитель.
  for (const o of d.offers.filter((x) => x.to === me && state.tick - x.tick < 300)) {
    const offerer = all.find((r) => r.id === o.from);
    const danger = Math.max(worstThreat(o.from), offerer?.threat ?? 0);
    const gain = offerer?.opportunity ?? 0;
    const trusted = (d.violations[o.from] ?? 0) <= myViolations + 1;
    out.push({ t: 'answerTreaty', from: o.from, accept: trusted && danger >= gain });
  }

  // Запрос помощи оборонительного пакта: вступаем, если агрессор не сильнее нас, иначе пакт рвётся.
  for (const call of (d.calls ?? []).filter((c) => c.ally === me)) {
    const aggressor = all.find((r) => r.id === call.aggressor);
    out.push({
      t: 'answerAid',
      aggressor: call.aggressor,
      join: (aggressor?.opportunity ?? FP) >= FP,
    });
  }
  // Голосования альянса: за, если у инициатора нарушений не больше наших плюс один; мир — всегда за.
  for (const vote of (d.votes ?? []).filter(
    (v) => v.voters.includes(me) && ![...v.yes, ...v.no].includes(me),
  )) {
    const trusted = (d.violations[vote.a] ?? 0) <= myViolations + 1;
    out.push({ t: 'castVote', voteId: vote.id, yes: vote.kind === 'peace' || trusted });
  }

  // Война: сильнейшая по соотношению сил цель, с которой я не в войне; разрыв договора дороже —
  // тем дороже, чем больше нарушений у меня уже есть.
  if (atWarNow.length === 0 && state.tick >= BOT_WAR_GRACE_TICKS) {
    const best = all
      .filter((r) => relationOf(state, me, r.id) !== 'war')
      .map((r) => {
        const bound = relationOf(state, me, r.id) === 'peace' ? 0 : 1;
        const need = FP + bound * FP * (1 + myViolations);
        return { r, margin: r.opportunity - need };
      })
      .filter((x) => x.margin >= 0)
      .sort((a, b) => b.margin * b.r.contact - a.margin * a.r.contact || a.r.id - b.r.id)[0];
    if (best) out.push({ t: 'declareWar', target: best.r.id });
  }

  // Предложения: сильному соседу — пакт (в том числе противнику, который сильнее меня). Раз в
  // минуту на бота (по окну тиков), чтобы отказы не превращались в спам.
  if (state.tick % PROPOSE_PERIOD_TICKS >= BOT_EASY_THINK_TICKS) return out;
  const proposed = new Set(d.offers.filter((o) => o.from === me).map((o) => o.to));
  for (const r of all) {
    if (r.threat < FP || proposed.has(r.id)) continue;
    const rel = relationOf(state, me, r.id);
    if (rel === 'pact' || rel === 'defense' || rel === 'alliance') continue;
    // С воюющим — мир, с остальными — пакт.
    out.push({ t: 'proposeTreaty', target: r.id, kind: rel === 'war' ? 'peace' : 'pact' });
  }
  return out;
}
