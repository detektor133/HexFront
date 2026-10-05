import type { PlayerView } from '@hexfront/sim';

export interface LeaderboardRow {
  readonly playerId: number;
  readonly hexes: number;
  readonly cities: number;
  readonly soldiers: number;
  readonly gold: number;
  readonly status: string;
}

/** Собирает показатели всех игроков из полного снимка песочницы. */
export function leaderboardRows(view: PlayerView): LeaderboardRow[] {
  return view.players.map((player) => ({
    playerId: player.id,
    hexes: view.hexes.owner.reduce((count, owner) => count + (owner === player.id ? 1 : 0), 0),
    cities: view.cities.reduce((count, city) => count + (city.owner === player.id ? 1 : 0), 0),
    soldiers: view.units.reduce(
      (count, unit) => count + (unit.owner === player.id ? unit.soldiers : 0),
      0,
    ),
    gold: player.gold,
    status: player.status,
  }));
}
