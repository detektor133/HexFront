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

/**
 * Сортирует строки по очкам; при равных очках выше тот, у кого больше городов, затем земли, затем
 * меньший номер: каждое место занимает один игрок.
 */
export function sortLeaderboardRows(rows: readonly LeaderboardRow[]): readonly LeaderboardRow[] {
  return [...rows].sort(
    (first, second) =>
      second.score - first.score ||
      second.cities - first.cities ||
      second.hexes - first.hexes ||
      first.playerId - second.playerId,
  );
}

/**
 * Гекс, к которому ведёт камеру клик по стране: столица, иначе любой видимый город, иначе любая
 * видимая клетка страны.
 * @returns номер гекса или null, если страны сейчас не видно
 */
export function countryHex(view: PlayerView, playerId: number): number | null {
  const cities = view.cities.filter((city) => city.owner === playerId);
  const city = cities.find((c) => c.isCapital) ?? cities[0];
  if (city) return city.hex;
  const index = view.hexes.owner.findIndex((owner) => owner === playerId);
  return index < 0 ? null : index;
}

/** Возвращает строки в порядке отображения лидерборда. */
export function visibleLeaderboardRows(view: PlayerView): readonly LeaderboardRow[] {
  return sortLeaderboardRows(leaderboardRows(view)).slice(0, 5);
}
