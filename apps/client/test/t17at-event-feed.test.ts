import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { GameEvent, PlayerView } from '@hexfront/sim';

import { appendEvents } from '../src/dev/event-feed.ts';

type CapturedEvent = Extract<GameEvent, { readonly t: 'cityCaptured' }> & {
  readonly previousOwnerId: number;
  readonly newOwnerId: number;
};

const view = { tick: 8, cities: [], armies: [], units: [] } as unknown as PlayerView;

const captured = (
  playerId: number,
  cityId: number,
  previousOwnerId: number,
  newOwnerId: number,
): CapturedEvent => ({
  t: 'cityCaptured',
  playerId,
  cityId,
  previousOwnerId,
  newOwnerId,
});

function appendForPlayer(
  events: readonly GameEvent[],
  localPlayerId: number,
): ReturnType<typeof appendEvents> {
  return Reflect.apply(appendEvents, null, [[], events, view, 100, localPlayerId]);
}

describe('07/T17at: фильтр ленты событий', () => {
  it('Приёмка 2: сохраняет не более четырёх последних допустимых событий и отбрасывает нерелевантные типы', () => {
    const events = [
      { t: 'unitDestroyed', playerId: 0, unitId: 1, hex: 1 },
      { t: 'unitDestroyed', playerId: 1, unitId: 2, hex: 2 },
      { t: 'unitCapitulated', playerId: 0, unitId: 3, hex: 3 },
      captured(1, 4, 1, 0),
      captured(0, 5, 0, 1),
      { t: 'unitDestroyed', playerId: 0, unitId: 6, hex: 6 },
      { t: 'unitRetreated', playerId: 0, unitId: 7, hex: 7 },
      { t: 'capitalMoved', playerId: 0, cityId: 8 },
      { t: 'commandRejected', playerId: 0, command: 'move', reason: 'badHex', auto: false },
      { t: 'unitRecruited', playerId: 0, cityId: 9, type: 'infantry' },
      { t: 'recruitCancelled', playerId: 0, cityId: 9, type: 'infantry' },
      { t: 'playerEliminated', playerId: 0 },
      { t: 'offensiveDone', playerId: 0, armyId: 10 },
      { t: 'matchWon', playerId: 0, reason: 'cities' },
      { t: 'constructionDone', playerId: 0, kind: 'depot', hex: 11 },
      { t: 'constructionCancelled', playerId: 0, kind: 'depot', hex: 12 },
    ] as GameEvent[];

    const items = appendForPlayer(events, 0);

    expect(items).toHaveLength(4);
    expect(items.map((item) => item.event)).toEqual([
      expect.objectContaining({ t: 'unitCapitulated', playerId: 0 }),
      expect.objectContaining({ t: 'cityCaptured', previousOwnerId: 1, newOwnerId: 0 }),
      expect.objectContaining({ t: 'cityCaptured', previousOwnerId: 0, newOwnerId: 1 }),
      expect.objectContaining({ t: 'unitDestroyed', unitId: 6, playerId: 0 }),
    ]);
  });

  it('Приёмка 2: не добавляет захват города, если localPlayerId не является прежним или новым владельцем', () => {
    expect(appendForPlayer([captured(2, 1, 1, 2)], 0)).toEqual([]);
  });

  it('Приёмка 2: не вводит новые типы войны или дипломатии', () => {
    const source = [
      readFileSync('apps/client/src/dev/event-feed.ts', 'utf8'),
      readFileSync('packages/sim/src/state/types.ts', 'utf8'),
    ].join('\n');
    expect(source).not.toMatch(/war|diplomac|войн|дипломат/u);
  });

  it('чужое событие среди сохраняемых записей отбрасывается', () => {
    const events = [
      { t: 'unitDestroyed', playerId: 0, unitId: 1, hex: 1 },
      { t: 'unitDestroyed', playerId: 1, unitId: 2, hex: 2 },
      { t: 'unitCapitulated', playerId: 0, unitId: 3, hex: 3 },
      captured(0, 4, 0, 1),
      captured(1, 5, 1, 0),
    ] as GameEvent[];

    const items = appendForPlayer(events, 0);

    expect(items).toHaveLength(4);
    expect(items.map((item) => item.event)).toEqual([
      expect.objectContaining({ t: 'unitDestroyed', unitId: 1, playerId: 0 }),
      expect.objectContaining({ t: 'unitCapitulated', playerId: 0 }),
      expect.objectContaining({ t: 'cityCaptured', previousOwnerId: 0, newOwnerId: 1 }),
      expect.objectContaining({ t: 'cityCaptured', previousOwnerId: 1, newOwnerId: 0 }),
    ]);
  });
});
