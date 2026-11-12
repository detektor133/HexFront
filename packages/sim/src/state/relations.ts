// Отношения игроков (дипломатия, CR-007): мир, война, пакт, союз. Без `state.diplomacy` матч
// «старый» — все игроки в войне друг с другом (тесты и режимы без дипломатии не меняются).
// GDD: docs/gdd/08-match.md — «Дипломатия».
import {
  ATTITUDE_MAX,
  ATT_BREACH_PUBLIC,
  ATT_PARTNER_CAP,
  ATT_PARTNER_GROWTH,
  ATT_TREATY_GAIN,
  ATT_WAR_ON_FRIEND,
  ATT_WAR_ON_ME,
} from '../balance.ts';
import type { Diplomacy, MatchState, Relation } from './types.ts';

/** Предложение договора живёт столько тиков, потом считается отклонённым. */
export const OFFER_TTL_TICKS = 300;

/** Пустая дипломатия: все пары в мире, нарушений нет. */
export function createDiplomacy(players: number): Diplomacy {
  return {
    relation: Array.from({ length: players * players }, () => 'peace' as Relation),
    violations: Array.from({ length: players }, () => 0),
    offers: [],
    attitude: Array.from({ length: players * players }, () => 0),
    changedAt: Array.from({ length: players * players }, () => 0),
  };
}

/** Сколько тиков пара в нынешнем отношении (война, мир, договор). */
export function relationAge(state: MatchState, a: number, b: number): number {
  return state.tick - (state.diplomacy?.changedAt?.[a * state.players.length + b] ?? 0);
}

/** Как a относится к b (−ATTITUDE_MAX…ATTITUDE_MAX); без дипломатии — безразлично. */
export function attitudeOf(state: MatchState, a: number, b: number): number {
  return state.diplomacy?.attitude?.[a * state.players.length + b] ?? 0;
}

/** Сдвигает отношение a → b на delta в пределах ±ATTITUDE_MAX. */
export function shiftAttitude(state: MatchState, a: number, b: number, delta: number): void {
  const d = state.diplomacy;
  if (!d || a === b || a < 0 || b < 0) return;
  const n = state.players.length;
  const attitude = (d.attitude ??= Array.from({ length: n * n }, () => 0));
  const next = (attitude[a * n + b] ?? 0) + delta;
  attitude[a * n + b] = Math.max(-ATTITUDE_MAX, Math.min(ATTITUDE_MAX, next));
}

/** Война aggressor → victim: жертва и её друзья (союзники, партнёры по обороне) держат зло на агрессора. */
export function recordWar(state: MatchState, aggressor: number, victim: number): void {
  shiftAttitude(state, victim, aggressor, -ATT_WAR_ON_ME);
  for (const friend of state.players) {
    if (friend.id === aggressor || friend.id === victim || friend.status !== 'alive') continue;
    const kind = relationOf(state, friend.id, victim);
    if (kind === 'alliance' || kind === 'defense') {
      shiftAttitude(state, friend.id, aggressor, -ATT_WAR_ON_FRIEND);
    }
  }
}

/** Договор заключён: стороны относятся друг к другу лучше. */
export function recordTreaty(
  state: MatchState,
  a: number,
  b: number,
  kind: keyof typeof ATT_TREATY_GAIN,
): void {
  shiftAttitude(state, a, b, ATT_TREATY_GAIN[kind]);
  shiftAttitude(state, b, a, ATT_TREATY_GAIN[kind]);
}

/** Договор нарушен: предателя знают все, и каждый относится к нему хуже. */
export function recordBreach(state: MatchState, traitor: number): void {
  for (const other of state.players) {
    if (other.id !== traitor && other.status === 'alive') {
      shiftAttitude(state, other.id, traitor, -ATT_BREACH_PUBLIC);
    }
  }
}

/** Раз в период: партнёры по договору доверяют больше, остальные обиды и симпатии остывают к нулю. */
export function driftAttitudes(state: MatchState): void {
  const d = state.diplomacy;
  if (!d?.attitude) return;
  const n = state.players.length;
  for (let a = 0; a < n; a += 1) {
    if (state.players[a]?.status !== 'alive') continue;
    for (let b = 0; b < n; b += 1) {
      if (a === b) continue;
      const now = d.attitude[a * n + b] ?? 0;
      const kind = d.relation[a * n + b];
      const partner = kind === 'pact' || kind === 'defense' || kind === 'alliance';
      if (partner && now < ATT_PARTNER_CAP) {
        d.attitude[a * n + b] = Math.min(ATT_PARTNER_CAP, now + ATT_PARTNER_GROWTH);
      } else if (!partner && now !== 0) {
        d.attitude[a * n + b] = now + (now > 0 ? -1 : 1);
      }
    }
  }
}

/** Отношение a → b; без дипломатии — война. */
export function relationOf(state: MatchState, a: number, b: number): Relation {
  const d = state.diplomacy;
  if (!d) return 'war';
  return d.relation[a * state.players.length + b] ?? 'war';
}

/** Игроки в состоянии войны (один и тот же игрок сам себе не враг). */
export function atWar(state: MatchState, a: number, b: number): boolean {
  if (a === b || a < 0 || b < 0) return a !== b;
  return relationOf(state, a, b) === 'war';
}

export function isAllied(state: MatchState, a: number, b: number): boolean {
  return a !== b && relationOf(state, a, b) === 'alliance';
}

/** Союзники игрока по альянсу (без него самого), по возрастанию id. */
export function allianceOf(state: MatchState, p: number): number[] {
  const out: number[] = [];
  for (let other = 0; other < state.players.length; other += 1) {
    if (isAllied(state, p, other)) out.push(other);
  }
  return out;
}

/** Игрок и его союзники по альянсу: одна «сторона» в договорах и голосованиях. */
export function groupOf(state: MatchState, p: number): number[] {
  return [p, ...allianceOf(state, p)].sort((x, y) => x - y);
}

/**
 * Общий обзор и проход: союзники по альянсу, а также пара оборонительного пакта, пока помощь
 * идёт войной (союзник воюет за пострадавшего).
 */
export function sharesWar(state: MatchState, a: number, b: number): boolean {
  if (a === b) return false;
  if (isAllied(state, a, b)) return true;
  return (state.diplomacy?.aid ?? []).some(
    (w) => (w.ally === a && w.victim === b) || (w.ally === b && w.victim === a),
  );
}

/** Ставит симметричное отношение пары. */
export function setRelation(state: MatchState, a: number, b: number, kind: Relation): void {
  const d = state.diplomacy;
  if (!d) return;
  const n = state.players.length;
  if (d.relation[a * n + b] !== kind) {
    const changedAt = (d.changedAt ??= Array.from({ length: n * n }, () => 0));
    changedAt[a * n + b] = state.tick;
    changedAt[b * n + a] = state.tick;
  }
  d.relation[a * n + b] = kind;
  d.relation[b * n + a] = kind;
}

/**
 * Чужой игрок b закрывает путь отряду игрока a: не в войне, не союзник — его отряды, города и
 * земля неприкосновенны (войти нельзя), пока не объявлена война. Союзник (и помогающий по оборонительному пакту) пропускает, не теряя земли.
 */
export function protectsFrom(state: MatchState, a: number, b: number): boolean {
  return a !== b && b >= 0 && !atWar(state, a, b) && !sharesWar(state, a, b);
}
