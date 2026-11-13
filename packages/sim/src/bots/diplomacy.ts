// Дипломатия ботов (CR-007; gdd/09-bots.md, «Дипломатия ботов»): решения по публичным признакам —
// сила игроков (очки матча), контакт границ, счётчик нарушений и отношения, которые складываются из
// поступков (война, договоры, захваты). Порогов «в коде» нет: сравниваются отношения сил в fixed-point
// и числа профиля сложности (balance.ts). Бот видит только то, что видел бы игрок.
import type { BotTickContext } from './context.ts';
import { assess, SWORN_ENEMY, warmth, type Peer, type Situation } from './diplomacy-model.ts';
import type { BotLevel } from './types.ts';
import {
  ATTITUDE_MAX,
  BOT_EASY_THINK_TICKS,
  BOT_PACT_MIN_TICKS,
  BOT_PEACE_LOCK_TICKS,
  BOT_RESTLESS_RAMP_TICKS,
  BOT_RESTLESS_START_TICKS,
  BOT_VOTE_DELAY_TICKS,
  BOT_WAR_GRACE_TICKS,
  BOT_WAR_MIN_TICKS,
  BOT_WAR_WEARY_TICKS,
} from '../balance.ts';
import type { Command } from '../commands/types.ts';
import { FP, intDiv } from '../math/int.ts';
import { OFFER_TTL_TICKS, groupOf, relationOf } from '../state/relations.ts';
import type { AllianceVote, MatchState, TreatyKind, TreatyOffer } from '../state/types.ts';

/** Предложения живут два срока жизни предложения; бот делает их раз в период профиля. */
const OFFER_FRESH_TICKS = OFFER_TTL_TICKS - 5;
/** Окно внутри периода, в котором бот может сделать предложения: хватает на одно решение любого уровня. */
const PROPOSE_WINDOW = BOT_EASY_THINK_TICKS;
/** Не больше стольких предложений за окно: отказы не должны превращаться в спам. */
const PROPOSALS_PER_WINDOW = 2;
/** Уступки в мире: проигрывающий (враг сильнее в столько раз) просит мира. */
const LOSING_THREAT = 1300;
/** Партнёр, к которому бот остыл настолько, рвёт договор или идёт на исключение из альянса. */
const BREAK_ATTITUDE = -250;
/** Теплота, с которой бот зовёт в пакт, оборонительный пакт и альянс. */
const COURT_PACT = -100;
const COURT_DEFENSE = 100;
const COURT_ALLIANCE = 250;
/** Перевес, при котором бот предпочитает покорить слабого соседа, а не заключать с ним пакт. */
const PREFER_CONQUEST = 1300;

const bound = (peer: Peer): boolean =>
  peer.relation === 'pact' || peer.relation === 'defense' || peer.relation === 'alliance';

// Самая большая угроза среди соседей, кроме except: чем она выше, тем нужнее договор.
function worstThreat(s: Situation, except: number): number {
  return Math.max(
    0,
    ...s.peers.filter((p) => p.id !== except && p.contact > 0).map((p) => p.threat),
  );
}

// Лёгкий бот берёт договор по старому правилу: сильный сосед рядом опаснее выгоды напасть на него.
function acceptSimple(s: Situation, peer: Peer): boolean {
  const danger = Math.max(worstThreat(s, peer.id), peer.threat);
  return peer.violations <= s.myViolations + 1 && danger >= peer.opportunity;
}

/** Принимает ли бот предложенный договор: теплота, общая угроза, выгода напасть самому. */
function accepts(s: Situation, offer: TreatyOffer, peer: Peer): boolean {
  // Свежая война не кончается миром, если бот не проигрывает: иначе агрессор мирился бы сразу.
  if (offer.kind === 'peace' && peer.age < BOT_WAR_MIN_TICKS && peer.threat < LOSING_THREAT) {
    return false;
  }
  if (!s.profile.coalitions) return acceptSimple(s, peer);
  const warm = warmth(s, peer);
  const trusted = peer.violations <= s.myViolations + 1 || s.profile.opportunist;
  const redirect = s.hegemon !== null && s.hegemon.id !== peer.id;
  switch (offer.kind) {
    case 'peace': {
      // Мир: тому, кого бот побеждает, он не нужен — пока война не затянулась или не появился общий враг.
      const winning = peer.opportunity >= s.profile.warEdge;
      return !winning || redirect || peer.age >= BOT_WAR_WEARY_TICKS;
    }
    case 'pact': {
      const appease = s.hegemon?.id === peer.id && peer.threat >= FP && peer.attitude > SWORN_ENEMY;
      const prey = s.profile.opportunist && peer.contact > 0 && peer.opportunity >= PREFER_CONQUEST;
      return appease || (trusted && warm > COURT_PACT - 50 && !prey);
    }
    case 'defense':
      return trusted && warm >= 0;
    case 'alliance':
      return trusted && warm >= COURT_ALLIANCE - 100 && peer.attitude > -100;
  }
}

// Голос бота в альянсе: за вход — если инициатор и новичок ему не враги; за мир — если не добивает;
// за исключение — если исключаемый враг, нарушитель или общая угроза.
function voteOf(s: Situation, vote: AllianceVote): boolean {
  const peer = (id: number): Peer | undefined => s.peers.find((p) => p.id === id);
  const a = peer(vote.a);
  const b = peer(vote.b);
  if (!s.profile.coalitions) {
    const trusted = (a?.violations ?? 0) <= s.myViolations + 1;
    if (vote.kind === 'peace') return true;
    if (vote.kind === 'kick') return (b?.violations ?? 0) > s.myViolations;
    return trusted;
  }
  if (vote.kind === 'peace') {
    const hated = [a, b].some((p) => p !== undefined && p.id !== s.me && p.attitude <= SWORN_ENEMY);
    return !hated;
  }
  if (vote.kind === 'kick') {
    return (
      b !== undefined &&
      (b.attitude <= -100 || b.violations > s.myViolations || s.hegemon?.id === b.id)
    );
  }
  const liked = (p: Peer | undefined): boolean => p === undefined || warmth(s, p) >= -100;
  return liked(a) && liked(b) && (a?.violations ?? 0) <= s.myViolations + 1;
}

// Ответы на предложения, запросы помощи и голосования.
function replies(state: MatchState, s: Situation): Command[] {
  const d = state.diplomacy;
  if (!d) return [];
  const out: Command[] = [];
  for (const o of d.offers.filter(
    (x) => x.to === s.me && state.tick - x.tick < OFFER_FRESH_TICKS,
  )) {
    const peer = s.peers.find((p) => p.id === o.from);
    out.push({
      t: 'answerTreaty',
      from: o.from,
      accept: peer !== undefined && accepts(s, o, peer),
    });
  }
  // Запрос помощи: вступаем, если агрессор не сильнее нас, или это общий враг, или жертва нам друг.
  for (const call of (d.calls ?? []).filter((c) => c.ally === s.me)) {
    const aggressor = s.peers.find((p) => p.id === call.aggressor);
    const victim = s.peers.find((p) => p.id === call.victim);
    const common = s.profile.coalitions && s.hegemon?.id === call.aggressor;
    const friend = s.profile.coalitions && victim !== undefined && victim.attitude > 100;
    out.push({
      t: 'answerAid',
      aggressor: call.aggressor,
      join: (aggressor?.opportunity ?? FP) >= FP || common || friend,
    });
  }
  // Голосования: бот отвечает не сразу (человек успевает увидеть ход голосования).
  const thinkTicks = BOT_VOTE_DELAY_TICKS + ((s.me * 13) % BOT_VOTE_DELAY_TICKS);
  for (const vote of (d.votes ?? []).filter(
    (v) =>
      v.voters.includes(s.me) &&
      ![...v.yes, ...v.no].includes(s.me) &&
      state.tick - v.tick >= thinkTicks,
  )) {
    out.push({ t: 'castVote', voteId: vote.id, yes: voteOf(s, vote) });
  }
  return out;
}

// Союзники по обороне, уже воюющие с игроком: с ними воевать легче.
function backers(state: MatchState, s: Situation, target: number): number {
  return s.peers.filter(
    (p) =>
      p.id !== target &&
      (p.relation === 'alliance' || p.relation === 'defense') &&
      relationOf(state, p.id, target) === 'war',
  ).length;
}

/**
 * Нетерпение бота: растёт, пока у него нет войн и мир с соседями не менялся, и снижает перевес,
 * нужный для нападения. Без него равные соседи сидели бы в границах до конца матча.
 * @returns снижение нужного перевеса, fixed-point (0 — нет)
 */
function restlessness(s: Situation): number {
  let quiet = Infinity;
  for (const p of s.peers) {
    if (p.contact === 0) continue;
    if (p.relation === 'war') return 0;
    if (p.relation === 'peace') quiet = Math.min(quiet, p.age);
  }
  if (quiet === Infinity) return 0;
  const over = Math.min(BOT_RESTLESS_RAMP_TICKS, Math.max(0, quiet - BOT_RESTLESS_START_TICKS));
  return intDiv(s.profile.restless * over, BOT_RESTLESS_RAMP_TICKS);
}

/**
 * Цель новой войны: сосед (или заморский соперник), которого бот сильнее с запасом профиля; при
 * поддержке союзников и против лидера запас меньше. Выбирается цель с наибольшей выгодой:
 * перевес и обида, умноженные на длину общей границы.
 */
function warTarget(state: MatchState, s: Situation): number | null {
  const wars = s.peers.filter((p) => p.relation === 'war').length;
  // Начало войн растянуто по ботам: не все нападают в первую же секунду после льготного периода.
  const start = BOT_WAR_GRACE_TICKS + ((s.me * 97) % 600);
  if (wars >= s.profile.maxWars || state.tick < start) return null;
  let best: { id: number; value: number } | null = null;
  const itch = restlessness(s);
  for (const p of s.peers) {
    if (p.relation === 'war' || p.contact === 0) continue;
    const hegemon = s.hegemon?.id === p.id;
    // Недавний мир и свежий пакт не рвутся ради добычи; лидера бьют, когда пора.
    if (!hegemon && p.relation === 'peace' && p.age < BOT_PEACE_LOCK_TICKS) continue;
    if (!hegemon && bound(p) && p.age < BOT_PACT_MIN_TICKS) continue;
    const backed = backers(state, s, p.id) > 0;
    // Договор рвёт тот, кто строит коалиции, но только за большой перевес (каждое нарушение дорожает);
    // оппортунисту хватает меньшего. Лёгкий бот договоров не рвёт.
    if (bound(p) && !s.profile.coalitions) continue;
    const breach = intDiv(FP * (1 + s.myViolations) * (s.profile.opportunist ? 6 : 10), 10);
    let need = s.profile.warEdge - itch + (bound(p) ? breach : 0);
    if (hegemon) need -= backed ? 500 : 300;
    else if (backed) need -= 200;
    need = Math.max(500, need);
    const margin = p.opportunity - need;
    if (margin < 0) continue;
    const hate = intDiv(s.profile.grudge * Math.max(0, -p.attitude), ATTITUDE_MAX);
    const value = p.contact * (margin + hate + (hegemon ? FP : 0));
    if (best === null || value > best.value || (value === best.value && p.id < best.id)) {
      best = { id: p.id, value };
    }
  }
  return best?.id ?? null;
}

// Следующая ступень договора для пары или null, если выше некуда.
function nextKind(peer: Peer): TreatyKind | null {
  if (peer.relation === 'war') return 'peace';
  if (peer.relation === 'peace') return 'pact';
  if (peer.relation === 'pact') return 'defense';
  if (peer.relation === 'defense') return 'alliance';
  return null;
}

// Предложения периода: мир проигрываемой войне или ради общей беды, коалиция против лидера, пакты.
function proposals(s: Situation, offered: ReadonlySet<number>): Command[] {
  const out: Command[] = [];
  const room = (): boolean => out.length < PROPOSALS_PER_WINDOW;
  const fresh = (p: Peer): boolean => !offered.has(p.id) && p.attitude > -ATTITUDE_MAX + 200;
  for (const p of s.peers.filter((x) => x.relation === 'war' && fresh(x))) {
    const losing = p.threat >= LOSING_THREAT;
    const redirect = s.profile.coalitions && s.hegemon !== null && s.hegemon.id !== p.id;
    const tired = p.age >= BOT_WAR_MIN_TICKS;
    if ((losing || (redirect && tired)) && room())
      out.push({ t: 'proposeTreaty', target: p.id, kind: 'peace' });
  }
  if (s.profile.coalitions) {
    const hegemonId = s.hegemon?.id ?? -1;
    // В коалицию зовут тех, кто боится того же лидера или воюет с тем же врагом.
    const candidates = s.peers
      .filter(
        (p) =>
          p.id !== hegemonId &&
          p.relation !== 'war' &&
          fresh(p) &&
          // Зовут соседей, общих врагов и действующих партнёров, а не весь список игроков подряд.
          (p.contact > 0 || p.commonFoes > 0 || bound(p)) &&
          (hegemonId >= 0 || p.commonFoes > 0),
      )
      .sort((x, y) => warmth(s, y) - warmth(s, x) || x.id - y.id);
    for (const p of candidates) {
      const kind = nextKind(p);
      const need =
        kind === 'pact' ? COURT_PACT : kind === 'defense' ? COURT_DEFENSE : COURT_ALLIANCE;
      if (kind === null || !room() || warmth(s, p) < need) continue;
      if (kind === 'alliance' && p.attitude < 100) continue;
      out.push({ t: 'proposeTreaty', target: p.id, kind });
    }
  }
  // Пакт сильному соседу (а лидер — любому соседу: ему коалиции не нужны, ему нужен покой).
  for (const p of s.peers) {
    const wanted = p.threat >= FP || s.iAmHegemon;
    if (!wanted || p.contact === 0 || p.relation !== 'peace' || !fresh(p) || !room()) continue;
    if (s.profile.coalitions && warmth(s, p) < COURT_PACT - 50) continue;
    if (out.some((c) => c.t === 'proposeTreaty' && c.target === p.id)) continue;
    out.push({ t: 'proposeTreaty', target: p.id, kind: 'pact' });
  }
  return out;
}

// Коалиция распадается: лидер среди своих — угроза и для них, обиженный партнёр — не друг.
function dissolve(state: MatchState, s: Situation): Command | null {
  if (!s.profile.coalitions) return null;
  for (const p of s.peers) {
    if (!bound(p)) continue;
    const overgrown = s.hegemon?.id === p.id;
    const hated = p.attitude <= BREAK_ATTITUDE;
    if (!overgrown && !hated) continue;
    if (p.relation === 'alliance') {
      // Члены альянса исключают его голосованием (без нарушения); вдвоём остаётся только разрыв.
      if (groupOf(state, s.me).length >= 3) return { t: 'proposeExpel', target: p.id };
      if (s.profile.opportunist) return { t: 'breakTreaty', target: p.id };
    } else if (s.profile.opportunist || hated) {
      return { t: 'breakTreaty', target: p.id };
    }
  }
  return null;
}

/**
 * Решения бота me по договорам и войне на этот тик.
 * @returns команды дипломатии (в порядке: ответы, распад коалиции, война, новые предложения)
 */
export function diplomacyCommands(
  state: MatchState,
  me: number,
  context: BotTickContext,
  level: BotLevel = 'medium',
): Command[] {
  const d = state.diplomacy;
  if (!d) return [];
  const s = assess(state, me, context, level);
  const out = replies(state, s);
  const split = dissolve(state, s);
  if (split) out.push(split);
  const target = warTarget(state, s);
  if (target !== null) out.push({ t: 'declareWar', target });
  // Предложения: раз в период профиля, в окне, смещённом по игроку, чтобы не все боты разом.
  if ((state.tick + me * 7) % s.profile.proposeEvery >= PROPOSE_WINDOW) return out;
  const offered = new Set(d.offers.filter((o) => o.from === me).map((o) => o.to));
  out.push(...proposals(s, offered));
  return out;
}
