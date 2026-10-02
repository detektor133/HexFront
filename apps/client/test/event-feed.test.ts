import { describe, expect, it } from 'vitest';

import type { GameEvent, PlayerView } from '@hexfront/sim';

import { appendEvents, EVENT_TTL_MS, eventHex, visibleEvents } from '../src/dev/event-feed.ts';

const view = { tick: 4, cities: [{ id: 7, hex: 12 }] } as unknown as PlayerView;

describe('лента событий', () => {
  it('ограничивается тремя записями и находит гекс города', () => {
    const events = [1, 2, 3, 4].map(
      (cityId) =>
        ({
          t: 'cityCaptured',
          playerId: 0,
          cityId,
        }) as GameEvent,
    );
    const items = appendEvents([], events, view, 100);
    expect(items).toHaveLength(3);
    expect(eventHex({ t: 'cityCaptured', playerId: 0, cityId: 7 }, view)).toBe(12);
  });

  it('удаляет запись ровно после шести секунд', () => {
    const event = { t: 'unitDestroyed', playerId: 0, unitId: 2, hex: 9 } as GameEvent;
    const item = appendEvents([], [event], view, 100)[0];
    if (!item) throw new Error('запись не добавлена');
    expect(visibleEvents([item], 100 + EVENT_TTL_MS)).toEqual([]);
  });
});
