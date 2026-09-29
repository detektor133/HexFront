import { describe, expect, it } from 'vitest';

import { matchEnd } from '../src/dev/match-end.ts';

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
