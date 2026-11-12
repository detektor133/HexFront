// Картина мира для дипломатии бота (09-bots.md, «Дипломатия ботов»): кто рядом, кто сильнее, кто
// слишком вырвался вперёд и как бот к каждому относится. Только публичное: очки матча, границы,
// счётчик нарушений и отношения (они складываются из поступков, которые видят все).
import type { BotTickContext } from './context.ts';
import { BOT_PROFILES, type BotProfile } from '../balance.ts';
import type { BotLevel } from './types.ts';
import { hexFromId, hexId, inBounds, neighbors } from '../math/hex.ts';
import { FP, intDiv, type Fp } from '../math/int.ts';
import { seaTargets } from '../queries/sea-route.ts';
import { isPortOf } from '../state/port.ts';
import { attitudeOf, relationAge, relationOf } from '../state/relations.ts';
import type { MatchState, Relation } from '../state/types.ts';

/** Один из соперников глазами бота. */
export interface Peer {
  readonly id: number;
  /** Очки матча (публичны). */
  readonly score: number;
  /** Сколько своих пограничных гексов касается этого игрока (или портов бота, откуда он досягаем по морю). */
  readonly contact: number;
  /** Моя сила к его силе, fixed-point: ≥ FP — я не слабее. */
  readonly opportunity: Fp;
  /** Его сила к моей, fixed-point: ≥ FP — он не слабее. */
  readonly threat: Fp;
  readonly relation: Relation;
  /** Сколько игроков воюют и с ботом, и с этим соперником: общий враг сближает. */
  readonly commonFoes: number;
  /** Сколько тиков пара в этом отношении. */
  readonly age: number;
  /** Как я отношусь к нему, −ATTITUDE_MAX…ATTITUDE_MAX. */
  readonly attitude: number;
  readonly violations: number;
}

/** Мир глазами бота. */
export interface Situation {
  readonly me: number;
  readonly profile: BotProfile;
  readonly myViolations: number;
  /** Все живые, кроме бота, по возрастанию id. */
  readonly peers: readonly Peer[];
  /** Игрок, оторвавшийся от остальных настолько, что бот видит в нём общую угрозу; не сам бот. */
  readonly hegemon: Peer | null;
  /** Сам бот в таком отрыве: коалиции ему не нужны, он их цель. */
  readonly iAmHegemon: boolean;
}

/** Среднему игроку очков в столько раз (в сотых) уступает лидер, которого боятся все, как бы ни был мал порог профиля. */
const ALARM_AVERAGE_PERCENT = 250;
/** Как часто бот ищет соперников за морем, тиков: поиск по воде дороже поиска по границе. */
const OVERSEAS_PERIOD_TICKS = 600;

/** Профиль бота своего уровня. */
export function profileOf(level: BotLevel): BotProfile {
  return BOT_PROFILES[level];
}

function landContact(state: MatchState, me: number, context: BotTickContext): Map<number, number> {
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
  return contact;
}

// Игроки за морем: чья земля у воды досягаема из портов бота. Только раз в OVERSEAS_PERIOD_TICKS,
// у каждого бота в свой тик.
function seaContact(
  state: MatchState,
  me: number,
  context: BotTickContext,
  known: ReadonlyMap<number, number>,
): Map<number, number> {
  const found = new Map<number, number>();
  if (state.tick % OVERSEAS_PERIOD_TICKS !== me % OVERSEAS_PERIOD_TICKS) return found;
  const g = { map: state.map, hexes: state.hexes, cities: state.cities };
  for (const hex of context.ownedHexes[me] ?? []) {
    if (!isPortOf(g, me, hex)) continue;
    for (const target of seaTargets(state.map, hex).keys()) {
      const owner = state.hexes.owner[target] ?? -1;
      if (owner >= 0 && owner !== me && !known.has(owner)) {
        found.set(owner, (found.get(owner) ?? 0) + 1);
      }
    }
  }
  return found;
}

// Лидер по очкам и угрожает ли он всем: его доля в сумме очков живых не меньше порога профиля, а в
// большом матче — не меньше ALARM_AVERAGE_PERCENT/100 средних игроков (иначе при 30 игроках порог
// профиля не сработал бы никогда).
function leaderOf(
  state: MatchState,
  scores: Int32Array,
  profile: BotProfile,
): { id: number; threatening: boolean } | null {
  let top = -1;
  let total = 0;
  let alive = 0;
  for (const p of state.players) {
    if (p.status !== 'alive') continue;
    alive += 1;
    total += scores[p.id] ?? 0;
    if (top < 0 || (scores[p.id] ?? 0) > (scores[top] ?? 0)) top = p.id;
  }
  // Угрозой всем лидер бывает только при трёх живых и больше: вдвоём это просто соперник.
  if (top < 0 || profile.alarmPercent <= 0 || alive < 3) return null;
  const share = total === 0 ? 0 : intDiv((scores[top] ?? 0) * 100, total);
  const threshold = Math.min(profile.alarmPercent, intDiv(ALARM_AVERAGE_PERCENT, alive));
  return { id: top, threatening: share >= threshold };
}

// Сколько живых игроков воюют и с a, и с b.
function commonFoes(state: MatchState, a: number, b: number): number {
  let count = 0;
  for (const q of state.players) {
    if (q.id === a || q.id === b || q.status !== 'alive') continue;
    if (relationOf(state, a, q.id) === 'war' && relationOf(state, b, q.id) === 'war') count += 1;
  }
  return count;
}

/**
 * Оценивает мир для бота me: соперники, лидер-угроза, отношения.
 * @returns ситуацию на этот тик
 */
export function assess(
  state: MatchState,
  me: number,
  context: BotTickContext,
  level: BotLevel,
): Situation {
  const profile = profileOf(level);
  const d = state.diplomacy;
  const scores = context.playerView.scores;
  const land = landContact(state, me, context);
  const sea = seaContact(state, me, context, land);
  const mine = (scores[me] ?? 0) + 1;
  const peers: Peer[] = [];
  for (const p of state.players) {
    if (p.id === me || p.status !== 'alive') continue;
    const theirs = (scores[p.id] ?? 0) + 1;
    peers.push({
      id: p.id,
      score: scores[p.id] ?? 0,
      contact: land.get(p.id) ?? sea.get(p.id) ?? 0,
      opportunity: intDiv(mine * FP, theirs) as Fp,
      threat: intDiv(theirs * FP, mine) as Fp,
      relation: relationOf(state, me, p.id),
      age: relationAge(state, me, p.id),
      commonFoes: commonFoes(state, me, p.id),
      attitude: attitudeOf(state, me, p.id),
      violations: d?.violations[p.id] ?? 0,
    });
  }
  const leader = leaderOf(state, scores, profile);
  const hegemon =
    leader?.threatening === true && leader.id !== me
      ? (peers.find((peer) => peer.id === leader.id) ?? null)
      : null;
  return {
    me,
    profile,
    myViolations: d?.violations[me] ?? 0,
    peers,
    hegemon,
    iAmHegemon: leader?.threatening === true && leader.id === me,
  };
}

/** Заклятый враг: ни пакта, ни союза, пока обида не остынет. */
export const SWORN_ENEMY = -500;
/** Общая угроза примиряет: насколько теплее бот смотрит на каждого, кто тоже боится лидера. */
const SHARED_THREAT_WARMTH = 250;
/** Общий враг в войне сближает: теплота за каждого, но не больше двух. */
const COMMON_FOE_WARMTH = 150;
const COMMON_FOE_CAP = 2;

/**
 * Теплота к игроку с учётом общей беды: враг моего врага — почти друг, но заклятый враг остаётся
 * врагом. Решает, с кем бот объединяется по своей воле.
 */
export function warmth(situation: Situation, peer: Peer): number {
  if (!situation.profile.coalitions || peer.attitude <= SWORN_ENEMY) return peer.attitude;
  const leader =
    situation.hegemon !== null && situation.hegemon.id !== peer.id ? SHARED_THREAT_WARMTH : 0;
  const foes = Math.min(peer.commonFoes, COMMON_FOE_CAP) * COMMON_FOE_WARMTH;
  return peer.attitude + Math.max(leader, foes);
}
