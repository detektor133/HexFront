import { describe, expect, it } from 'vitest';

import type { GameEvent, PlayerView } from '@hexfront/sim';

import { hireEstimate } from '../src/dev/army-limit.ts';
import { appendEvents } from '../src/dev/event-feed.ts';
import { politicalKind } from '../src/render/political.ts';

const viewWith = (relations: readonly string[], blocs: readonly number[]): PlayerView =>
  ({
    tick: 5,
    playerId: 0,
    cities: [],
    armies: [],
    units: [],
    diplomacy: { relations, blocs, violations: [], incoming: [], outgoing: [] },
  }) as unknown as PlayerView;

const fall = (playerId: number): GameEvent => ({ t: 'playerEliminated', playerId });

describe('интерфейс дипломатии', () => {
  it('капитуляция попадает в ленту только у врага, с кем война', () => {
    const view = viewWith(['peace', 'war', 'peace'], [0, 1, 2]);
    expect(appendEvents([], [fall(1)], view, 0, 0)).toHaveLength(1);
    expect(appendEvents([], [fall(2)], view, 0, 0)).toHaveLength(0);
    expect(appendEvents([], [fall(0)], view, 0, 0)).toHaveLength(0);
  });

  it('политическая карта: свой блок и враги, чужой альянс, одиночка', () => {
    const view = viewWith(['peace', 'peace', 'war', 'peace', 'peace'], [0, 0, 2, 3, 3]);
    expect(politicalKind(view, 0)).toBe('own');
    expect(politicalKind(view, 1)).toBe('own');
    expect(politicalKind(view, 2)).toBe('war');
    expect(politicalKind(view, 3)).toBe('bloc');
    expect(politicalKind(view, 4)).toBe('bloc');
    const solo = viewWith(['peace', 'peace'], [0, 1]);
    expect(politicalKind(solo, 1)).toBe('solo');
  });

  it('оценка найма — целые числа, без хвоста после запятой', () => {
    const have = { infantry: 1000.3333, armor: 0, artillery: 0 };
    const hire = hireEstimate(have, { infantry: 2000, armor: 0, artillery: 0 });
    expect(Number.isInteger(hire.soldiers)).toBe(true);
    expect(Number.isInteger(hire.gold)).toBe(true);
  });
});
