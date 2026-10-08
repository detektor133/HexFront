// Итог матча для карточки «Конец матча» (07-controls.md, «Экраны MVP», п. 4; упрощённо, 04/T24):
// победа или поражение, место, победитель. Статистика и таймлапс — 05/T6.

/** Что нужно из снимка игрока. */
interface EndView {
  readonly playerId: number;
  readonly winner: number;
  readonly me: { readonly place: number; readonly players: number };
  readonly players: readonly { readonly id: number }[];
}

interface StatisticsView {
  readonly playerId: number;
  readonly hexes: { readonly owner: ArrayLike<number> };
  readonly cities: readonly { readonly owner: number }[];
  readonly units: readonly { readonly owner: number; readonly soldiers: number }[];
  readonly players: readonly { readonly id: number; readonly gold: number }[];
  readonly me: { readonly score: number };
}

export interface MatchStatistics {
  readonly hexes: number;
  readonly cities: number;
  readonly soldiers: number;
  readonly gold: number;
  readonly score: number;
}

/** Статистика игрока для итогового экрана. */
export function matchStatistics(view: StatisticsView): MatchStatistics {
  const player = view.players.find((item) => item.id === view.playerId);
  return {
    hexes: Array.from(view.hexes.owner).filter((owner) => owner === view.playerId).length,
    cities: view.cities.filter((city) => city.owner === view.playerId).length,
    soldiers: view.units
      .filter((unit) => unit.owner === view.playerId)
      .reduce((total, unit) => total + unit.soldiers, 0),
    gold: player?.gold ?? 0,
    score: view.me.score,
  };
}

/** Сжимает историю снимков до 16 кадров: по одному кадру на секунду реплея. */
export function replayFrames<T>(views: readonly T[], maxFrames: number = 16): readonly T[] {
  if (views.length === 0 || maxFrames < 1) return [];
  if (views.length <= maxFrames) return views;
  return Array.from({ length: maxFrames }, (_, index) => {
    const source = Math.floor((index * (views.length - 1)) / (maxFrames - 1));
    return views[source] as T;
  });
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
