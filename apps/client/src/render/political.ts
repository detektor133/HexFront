// Политическая карта: цвет страны по тому, кто она вам. Свои и союзники по альянсу — зелёные, те, с
// кем война, — красные, остальные альянсы — каждый своим цветом из палитры игроков, одиночки — серые.
import type { PlayerView } from '@hexfront/sim';

import { mixWithWhite } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

export type PoliticalKind = 'own' | 'war' | 'bloc' | 'solo';

/** Кто страна `id` вам: свой блок, война, чужой альянс или одиночка. */
export function politicalKind(view: PlayerView, id: number): PoliticalKind {
  const d = view.diplomacy;
  if (id === view.playerId) return 'own';
  if (!d) return 'war';
  const blocs = d.blocs;
  if (blocs[id] === blocs[view.playerId]) return 'own';
  if (d.relations[id] === 'war') return 'war';
  const size = blocs.filter((b) => b === blocs[id]).length;
  return size > 1 ? 'bloc' : 'solo';
}

/** Цвет линии страны на политической карте. */
export function politicalLine(view: PlayerView, id: number): string {
  const kind = politicalKind(view, id);
  if (kind === 'own') return tokens.relation.own;
  if (kind === 'war') return tokens.relation.enemy;
  if (kind === 'solo') return tokens.neutral.line;
  const pool = tokens.players.palette;
  const bloc = view.diplomacy?.blocs[id] ?? id;
  return pool[bloc % pool.length]?.line ?? tokens.neutral.line;
}

/** Заливка страны на политической карте. */
export function politicalFill(view: PlayerView, id: number): string {
  return mixWithWhite(politicalLine(view, id), tokens.territory.fillMix);
}
