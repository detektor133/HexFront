// Отношения игроков (дипломатия, CR-007): мир, война, пакт, союз. Без `state.diplomacy` матч
// «старый» — все игроки в войне друг с другом (тесты и режимы без дипломатии не меняются).
// GDD: docs/gdd/08-match.md — «Дипломатия».
import type { Diplomacy, MatchState, Relation } from './types.ts';

/** Предложение договора живёт столько тиков, потом считается отклонённым. */
export const OFFER_TTL_TICKS = 300;

/** Пустая дипломатия: все пары в мире, нарушений нет. */
export function createDiplomacy(players: number): Diplomacy {
  return {
    relation: Array.from({ length: players * players }, () => 'peace' as Relation),
    violations: Array.from({ length: players }, () => 0),
    offers: [],
  };
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
