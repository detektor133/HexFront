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
  reason: 'cityTooClose' | 'depotTooClose' | 'notOwnHex' | 'popTooLow',
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
  depot: rule('depotTooClose'),
  rebuild: null,
  recruit: [],
  ...checks,
});

describe('действия карточки гекса', () => {
  it('нейтральный или чужой гекс — без действий', () => {
    expect(visibleActions(plain(), -1, 0, false)).toEqual([]);
    expect(visibleActions(plain(), 1, 0, false)).toEqual([]);
  });

  it('запрещённые по правилам видимы с причиной, «не хватает золота» — видимо с ценой', () => {
    const actions = visibleActions(plain(), 0, 0, false);
    expect(actions.map((a) => [a.kind, a.cost, a.affordable, a.blocked])).toEqual([
      ['foundCity', 0, false, 'cityTooClose'],
      ['improve', 20_000, true, undefined],
      ['fort', 60_000, false, undefined],
      ['depot', 0, false, 'depotTooClose'],
    ]);
  });

  it('«Основать город» видна с причиной запрета и доступна при разрешении', () => {
    expect(visibleActions(plain(), 0, 0, false)).toContainEqual(
      expect.objectContaining({ kind: 'foundCity', affordable: false, blocked: 'cityTooClose' }),
    );
    expect(visibleActions(plain({ foundCity: rule('popTooLow') }), 0, 0, false)).toContainEqual(
      expect.objectContaining({ kind: 'foundCity', affordable: false, blocked: 'popTooLow' }),
    );
    const ready = visibleActions(plain({ foundCity: ok(120_000) }), 0, 0, false)[0];
    expect(ready).toMatchObject({ kind: 'foundCity', affordable: true });
    expect(ready?.blocked).toBeUndefined();
  });

  it('пока на гексе идёт стройка — действий нет', () => {
    expect(visibleActions(plain(), 0, 0, true)).toEqual([]);
  });

  it('передаёт путь перестройки снабжения для подсветки', () => {
    const city = {
      id: 7,
      upgrade: ok(10),
      rebuild: {
        ok: true,
        cityHex: 5,
        path: [5, 6, 7],
        toBuild: [6, 7],
        cost: 20 as Fp,
        affordable: true,
      },
    } as unknown as NonNullable<Selection['city']>;
    const road = visibleActions(plain({ city }), 0, 0, false).find((a) => a.kind === 'rebuild');
    expect(road).toMatchObject({ kind: 'rebuild', previewPath: [5, 6, 7] });
  });

  it('показывает дорогу для изолированного склада и причину для подключённого', () => {
    const plan = {
      ok: true,
      cityHex: 5,
      path: [5, 6, 7],
      toBuild: [6, 7],
      cost: 20 as Fp,
      affordable: true,
    } as const;
    const isolated = visibleActions(plain({ rebuild: plan }), 0, 0, false).find(
      (a) => a.kind === 'rebuild',
    );
    expect(isolated).toMatchObject({
      cmd: { t: 'rebuildSupply', hex: 5 },
      previewPath: plan.path,
      cost: plan.cost,
    });
    expect(
      visibleActions(plain({ rebuild: { ok: false, reason: 'notIsolated' } }), 0, 0, false),
    ).toContainEqual(
      expect.objectContaining({ kind: 'rebuild', affordable: false, blocked: 'notIsolated' }),
    );
  });
});
