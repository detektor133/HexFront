// Единственное место смены владельца гекса: захват, выбывание, старт матча и тестовый DSL идут
// через setHexOwner, чтобы фронты рядом переносились сразу (04/T13).
// GDD: docs/gdd/07-controls.md — «Линия фронта».
import { followFrontsNear } from './front.ts';
import type { MatchState } from './types.ts';
import type { HexId } from '../math/hex.ts';

/** Меняет владельца гекса (id игрока или NEUTRAL) и переносит фронты у этого гекса. */
export function setHexOwner(state: MatchState, hex: HexId, owner: number): void {
  if (state.hexes.owner[hex] === owner) return;
  state.hexes.owner[hex] = owner;
  followFrontsNear(state, hex);
}
