import type { PlayerView } from '@hexfront/sim';

export interface LeaderboardRow {
  readonly playerId: number;
  readonly place: number;
  readonly hexes: number;
  readonly cities: number;
  readonly score: number;
}

/** Собирает лидерборд из рейтинга и видимых объектов снимка. */
export function leaderboardRows(view: PlayerView): LeaderboardRow[] {
  return (view.ranking ?? []).map((entry) => ({
    playerId: entry.id,
    place: entry.place,
    hexes: view.hexes.owner.reduce((count, owner) => count + (owner === entry.id ? 1 : 0), 0),
    cities: view.cities.reduce((count, city) => count + (city.owner === entry.id ? 1 : 0), 0),
    score: entry.score,
  }));
}
