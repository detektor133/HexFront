import { describe, expect, it } from 'vitest';

import type { GameEvent, PlayerView } from '@hexfront/sim';

import { appendEvents, EVENT_TTL_MS, visibleEvents } from '../src/dev/event-feed.ts';

const view = {
  tick: 1,
  playerId: 0,
  cities: [{ id: 3, hex: 77 }],
  armies: [],
  units: [],
} as never as PlayerView;

describe('исходы боёв в ленте', () => {
  const own: GameEvent[] = [
    { t: 'unitDestroyed', playerId: 0, unitId: 1, hex: 5 },
    { t: 'unitCapitulated', playerId: 0, unitId: 2, hex: 6 },
    { t: 'cityCaptured', cityId: 3, previousOwnerId: 1, newOwnerId: 0 },
  ] as never;

  it('три своих события попадают в ленту с гексом для центрирования', () => {
    const items = appendEvents([], own, view, 0);
    expect(items.map((i) => i.event.t)).toEqual([
      'unitDestroyed',
      'unitCapitulated',
      'cityCaptured',
    ]);
    expect(items.map((i) => i.hex)).toEqual([5, 6, 77]);
  });

  it('чужие события отбрасываются, не более четырёх, срок жизни из EVENT_TTL_MS', () => {
    const foreign: GameEvent[] = [
      { t: 'unitRetreated', playerId: 1, unitId: 9, hex: 1 },
      { t: 'unitDestroyed', playerId: 1, unitId: 8, hex: 2 },
    ] as never;
    expect(appendEvents([], foreign, view, 0)).toEqual([]);
    const items = appendEvents(appendEvents([], own, view, 0), own, view, 100);
    expect(items).toHaveLength(4);
    expect(visibleEvents(items, EVENT_TTL_MS - 1)).toHaveLength(4);
    expect(visibleEvents(items, 100 + EVENT_TTL_MS)).toHaveLength(0);
  });
});
