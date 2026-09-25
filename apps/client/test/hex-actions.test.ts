import { describe, expect, it } from 'vitest';

import type { ConstructionCheck, Fp } from '@hexfront/sim';

import { visibleActions } from '../src/dev/hex-actions.ts';
import type { Selection } from '../src/local/messages.ts';

const ok = (cost: number): ConstructionCheck => ({ ok: true, cost: cost as Fp, timeS: 1000 as Fp });
const noGold = (cost: number): ConstructionCheck => ({
  ok: false,
  reason: 'notEnoughGold',
  cost: cost as Fp,
  timeS: 1000 as Fp,
});
const rule = (
  reason: 'cityTooClose' | 'depotNeedsRoad' | 'notOwnHex' | 'popTooLow',
): ConstructionCheck => ({
  ok: false,
  reason,
});

const plain = (checks: Partial<Selection> = {}): Selection => ({
  hex: 5,
  popCap: 100_000,
  city: null,
  foundCity: rule('cityTooClose'),
  improve: ok(20_000),
  fort: noGold(60_000),
  depot: rule('depotNeedsRoad'),
  recruit: [],
  ...checks,
});

describe('действия карточки гекса', () => {
  it('нейтральный или чужой гекс — без действий', () => {
    expect(visibleActions(plain(), -1, 0, false)).toEqual([]);
    expect(visibleActions(plain(), 1, 0, false)).toEqual([]);
  });

  it('недоступные по правилам скрыты, «не хватает золота» — с ценой', () => {
    const actions = visibleActions(plain(), 0, 0, false).filter((a) => a.kind !== 'foundCity');
    expect(actions.map((a) => [a.kind, a.cost, a.affordable])).toEqual([
      ['improve', 20_000, true],
      ['fort', 60_000, false],
    ]);
  });

  it('«Основать город» видна всегда — недоступная с причиной (ui.md)', () => {
    const [found] = visibleActions(plain(), 0, 0, false);
    expect(found).toMatchObject({ kind: 'foundCity', affordable: false, blocked: 'cityTooClose' });
    const low = visibleActions(plain({ foundCity: rule('popTooLow') }), 0, 0, false)[0];
    expect(low).toMatchObject({ kind: 'foundCity', blocked: 'popTooLow' });
    const ready = visibleActions(plain({ foundCity: ok(120_000) }), 0, 0, false)[0];
    expect(ready).toMatchObject({ kind: 'foundCity', affordable: true });
    expect(ready?.blocked).toBeUndefined();
  });

  it('пока на гексе идёт стройка — действий нет', () => {
    expect(visibleActions(plain(), 0, 0, true)).toEqual([]);
  });
});
