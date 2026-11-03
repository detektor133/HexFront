import { describe, expect, it } from 'vitest';

import { battleSides, markerAt } from '../src/dev/battle-panel.ts';

const unit = (id: number, owner: number, over: Record<string, unknown> = {}) => ({
  id,
  owner,
  type: 'infantry',
  soldiers: 10_000,
  org: 100_000,
  hex: 1,
  order: 'idle',
  target: -1,
  ...over,
});

describe('панель боя', () => {
  it('стороны: атакующие с приказом на цель и защитники в гексе, суммы солдат', () => {
    const view = {
      units: [
        unit(1, 0, { order: 'attack', target: 9, soldiers: 8_000 }),
        unit(2, 0, { order: 'attack', target: 9, type: 'armor', soldiers: 4_000 }),
        unit(3, 1, { hex: 9, soldiers: 5_000 }),
        unit(4, 2, { hex: 7, soldiers: 99_000 }),
      ],
    } as never;
    const s = battleSides(view, 9);
    expect(s.attackers.soldiers).toBe(12);
    expect(s.attackers.types).toEqual(['infantry', 'armor']);
    expect(s.defenders.soldiers).toBe(5);
    expect(s.advantage).toBeCloseTo(2 / 3);
  });

  it('попадание в маркер и мимо', () => {
    const anchor = { sourceHex: 1, targetHex: 9, at: { x: 10, y: 10 } };
    expect(markerAt([anchor], { x: 12, y: 10 }, 5)).toBe(anchor);
    expect(markerAt([anchor], { x: 30, y: 10 }, 5)).toBeNull();
  });
});
