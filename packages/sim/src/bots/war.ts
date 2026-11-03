// Кто сейчас враг в снимке игрока (дипломатия, CR-007): без дипломатии — все, иначе — только те,
// с кем война. Мир, пакт и союз — не враги: фронта и ударов по ним нет.
import type { PlayerView } from '../queries/player-view.ts';

export function warWith(view: PlayerView, other: number): boolean {
  if (other < 0 || other === view.playerId) return false;
  const relations = view.diplomacy?.relations;
  return relations === undefined || relations[other] === 'war';
}
