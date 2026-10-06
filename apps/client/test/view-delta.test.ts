import { describe, expect, it, vi } from 'vitest';

import type { DeltaMessage, SnapshotMessage } from '@hexfront/protocol';
import type { Fp, PlayerView } from '@hexfront/sim';

import {
  ConfirmedViewDeltaStream,
  ViewDeltaApplier,
  buildViewDelta,
} from '../src/local/view-delta.ts';

const makeView = (): PlayerView => ({
  tick: 1,
  winner: -1,
  playerId: 0,
  hexes: {
    owner: Int16Array.from([0, -1]),
    pop: Int32Array.from([1000, 0]),
    improvement: Uint8Array.from([0, 0]),
    building: Uint8Array.from([0, 0]),
    road: Uint8Array.from([0, 0]),
    link: Uint8Array.from([1, 0]),
    growth: Int32Array.from([2, 0]),
    visible: Uint8Array.from([1, 1]),
  },
  cities: [],
  units: [],
  armies: [],
  plans: [],
  players: [],
  me: {
    popTotal: 1000,
    popGrowthPerS: 2,
    incomePerS: 0,
    incomeAtTargetPerS: 0,
    upkeepPerS: 0,
    supplyLevel: 1000 as Fp,
    bankrupt: false,
    autoReinforce: true,
    autoCommand: true,
    foundCityCost: 0 as Fp,
    growthMultAtTarget: 1000 as Fp,
    score: 0,
    place: 1,
    players: 1,
  },
  constructions: [],
  recruits: [],
});

const snapshot = (): SnapshotMessage => ({ t: 'snapshot', tick: 1, view: makeView() });

const delta = (events: DeltaMessage['d']['events'] = []): DeltaMessage => ({
  t: 'delta',
  baseTick: 1,
  tick: 2,
  d: {
    hexes: [{ id: 0, owner: 1 }],
    units: {
      upsert: [
        {
          id: 3,
          owner: 1,
          type: 'infantry',
          soldiers: 500 as Fp,
          org: 1000 as Fp,
          hex: 0,
          order: 'idle',
          target: -1,
          moveTicks: 0,
          moveTotal: 0,
          supplyLevel: null,
          encircled: null,
          starving: null,
          armyId: null,
          path: [],
          fireTarget: -1,
        },
      ],
      removed: [],
    },
    fronts: { upsert: [], removed: [] },
    events,
  },
});

describe('применение дельта-снимков на клиенте', () => {
  it('строит компактную дельту без изменений территории и сохраняет события', () => {
    const before = makeView();
    const after = { ...makeView(), tick: 2 };
    const event = { t: 'playerEliminated' as const, playerId: 1 };

    const message = buildViewDelta(before, after, [event]);

    expect(message).toEqual({
      t: 'delta',
      baseTick: 1,
      tick: 2,
      d: {
        hexes: [],
        units: { upsert: [], removed: [] },
        fronts: { upsert: [], removed: [] },
        events: [event],
      },
    });
    expect(JSON.stringify(message).length).toBeLessThan(JSON.stringify(snapshot()).length);
  });

  it('после подтверждения строит дельту, а смена вида и тумана возвращает полный снимок', () => {
    const stream = new ConfirmedViewDeltaStream();
    const first = stream.next(makeView(), []);
    expect(first?.kind).toBe('snapshot');
    stream.acknowledge();

    const second = stream.next({ ...makeView(), tick: 2 }, []);
    expect(second?.kind).toBe('delta');
    stream.acknowledge();

    stream.requestFull();
    expect(stream.next({ ...makeView(), tick: 3 }, [])?.kind).toBe('snapshot');
    stream.acknowledge();
    stream.requestFull();
    expect(stream.next({ ...makeView(), tick: 4 }, [])?.kind).toBe('snapshot');
  });

  it('последовательно применяет изменения и не дублирует повторную дельту', () => {
    const applier = new ViewDeltaApplier();
    applier.applySnapshot(snapshot());
    const event = { t: 'playerEliminated' as const, playerId: 1 };

    applier.applyDelta(delta([event]));
    applier.applyDelta(delta([event]));

    expect(applier.view?.tick).toBe(2);
    expect(applier.view?.hexes.owner[0]).toBe(1);
    expect(applier.view?.units).toHaveLength(1);
    expect(applier.events).toEqual([event]);
  });

  it('запрашивает полный снимок при старте, смене вида и тумана', () => {
    const request = vi.fn();
    const applier = new ViewDeltaApplier(request);

    expect(request).toHaveBeenCalledWith('start');
    applier.applySnapshot(snapshot());
    applier.requestViewChange();
    applier.applySnapshot(snapshot());
    applier.requestFogChange();

    expect(request.mock.calls.map(([reason]) => reason)).toEqual(['start', 'view', 'fog']);
  });

  it('отклоняет дельту, если она не построена от текущей базы', () => {
    const applier = new ViewDeltaApplier();
    applier.applySnapshot(snapshot());

    expect(() => applier.applyDelta({ ...delta(), baseTick: 0 })).toThrow('Неверная база дельты');
  });
});
