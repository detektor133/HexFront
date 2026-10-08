import { describe, expect, it } from 'vitest';

import { matchEnd, matchStatistics, replayFrames } from '../src/dev/match-end.ts';

const view = (winner: number, place: number) => ({
  playerId: 0,
  winner,
  me: { place, players: 3 },
  players: [{ id: 0 }, { id: 1 }, { id: 2 }],
});

describe('конец матча (04/T24)', () => {
  it('победителя нет — карточки нет', () => {
    expect(matchEnd(view(-1, 2))).toBeNull();
  });

  it('победил игрок — «Победа», место 1', () => {
    expect(matchEnd(view(0, 1))).toEqual({ won: true, place: 1, of: 3, winner: 1 });
  });

  it('победил другой — «Поражение», место и номер победителя (с 1)', () => {
    expect(matchEnd(view(2, 3))).toEqual({ won: false, place: 3, of: 3, winner: 3 });
  });
});

describe('статистика и таймлапс конца матча (05/T6d)', () => {
  it('собирает статистику игрока из итогового снимка', () => {
    const result = matchStatistics({
      ...view(0, 1),
      hexes: { owner: Int16Array.from([0, 0, 1, -1]) },
      cities: [{ owner: 0 }],
      units: [{ owner: 0, soldiers: 2500 }],
      players: [{ id: 0, gold: 1200 }],
      me: { score: 42 },
    });

    expect(result).toEqual({ hexes: 2, cities: 1, soldiers: 2500, gold: 1200, score: 42 });
  });

  it('ограничивает таймлапс 16 кадрами и сохраняет первый и последний', () => {
    const frames = Array.from({ length: 20 }, (_, tick) => ({ tick }));
    const result = replayFrames(frames);

    expect(result).toHaveLength(16);
    expect(result[0]).toEqual({ tick: 0 });
    expect(result.at(-1)).toEqual({ tick: 19 });
  });

  it('не создаёт кадры для пустой истории', () => {
    expect(replayFrames([])).toEqual([]);
  });
});
