// Итог матча для карточки «Конец матча» (07-controls.md, «Экраны MVP», п. 4; упрощённо, 04/T24):
// победа или поражение, место, победитель. Статистика и таймлапс — 05/T6.

/** Что нужно из снимка игрока. */
interface EndView {
  readonly playerId: number;
  readonly winner: number;
  readonly me: { readonly place: number; readonly players: number };
  readonly players: readonly { readonly id: number }[];
}

/** Итог для карточки. */
export interface MatchEndInfo {
  readonly won: boolean;
  readonly place: number;
  readonly of: number;
  /** Номер победителя для подписи «игрок N», с 1. */
  readonly winner: number;
}

/**
 * Итог матча по снимку.
 * @returns итог или null, пока победителя нет
 */
export function matchEnd(view: EndView): MatchEndInfo | null {
  if (view.winner < 0) return null;
  const won = view.winner === view.playerId;
  return {
    won,
    place: won ? 1 : view.me.place,
    of: view.players.length,
    winner: view.winner + 1,
  };
}
