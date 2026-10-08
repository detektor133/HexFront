import {
  FP,
  intDiv,
  SCORE_CITY,
  SCORE_HEX,
  SCORE_PER_100_SOLDIERS,
  type PlayerView,
} from '@hexfront/sim';

export interface LeaderboardRow {
  readonly playerId: number;
  readonly hexes: number;
  readonly cities: number;
  readonly soldiers: number;
  readonly gold: number;
  readonly score: number;
  readonly status: string;
}

/** Собирает показатели всех игроков из полного снимка песочницы. */
export function leaderboardRows(view: PlayerView): LeaderboardRow[] {
  const rows = view.players.map((player) => {
    const hexes = view.hexes.owner.reduce(
      (count, owner) => count + (owner === player.id ? 1 : 0),
      0,
    );
    const cities = view.cities.reduce(
      (count, city) => count + (city.owner === player.id ? 1 : 0),
      0,
    );
    const soldiers = view.units.reduce(
      (count, unit) => count + (unit.owner === player.id ? unit.soldiers : 0),
      0,
    );
    return {
      playerId: player.id,
      hexes,
      cities,
      soldiers,
      gold: player.gold,
      score:
        SCORE_CITY * cities +
        SCORE_HEX * hexes +
        SCORE_PER_100_SOLDIERS * intDiv(soldiers, 100 * FP),
      status: player.status,
    };
  });
  return rows.sort((a, b) => {
    const statusOrder = Number(a.status === 'eliminated') - Number(b.status === 'eliminated');
    return statusOrder || b.score - a.score || a.playerId - b.playerId;
  });
}
