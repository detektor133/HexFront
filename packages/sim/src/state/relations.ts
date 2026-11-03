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
 * земля неприкосновенны (войти нельзя), пока не объявлена война. Союзник пропускает, не теряя земли.
 */
export function protectsFrom(state: MatchState, a: number, b: number): boolean {
  return a !== b && b >= 0 && !atWar(state, a, b) && !isAllied(state, a, b);
}
