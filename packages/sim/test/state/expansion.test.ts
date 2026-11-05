import { describe, expect, it } from 'vitest';

import { FP } from '../../src/math/int.ts';
import { planExpansion, type ExpansionCell } from '../../src/state/expansion.ts';

// Гексы на одной линии: расстояние — разность номеров.
const dist = (a: number, b: number): number => Math.abs(a - b);
const cell = (hex: number, cost = 0, safe = true): ExpansionCell => ({ hex, cost, safe });
const MIN = 50 * FP;

describe('раздача ничьих гексов', () => {
  it('отряд рядом со свободной клеткой берёт её, а не бежит на другой конец', () => {
    const orders = planExpansion(
      [{ id: 1, hex: 10, soldiers: 100 * FP }],
      [cell(11), cell(60)],
      dist,
      MIN,
    );
    expect(orders).toEqual([{ unitId: 1, main: 11, parts: [] }]);
  });

  it('гексы раздаются ближайшим отрядам, у каждого свой', () => {
    const orders = planExpansion(
      [
        { id: 1, hex: 0, soldiers: 60 * FP },
        { id: 2, hex: 20, soldiers: 60 * FP },
      ],
      [cell(1), cell(19)],
      dist,
      MIN,
    );
    expect(orders.map((o) => [o.unitId, o.main])).toEqual([
      [1, 1],
      [2, 19],
    ]);
  });

  it('когда гексов больше, крупный отряд делится поровну по числу свободных гексов рядом', () => {
    const orders = planExpansion(
      [{ id: 1, hex: 10, soldiers: 300 * FP }],
      [cell(11), cell(12), cell(9)],
      dist,
      MIN,
    );
    const order = orders[0];
    expect(order?.parts).toHaveLength(2);
    // Три равные доли по 100 солдат: свой отряд и две части.
    expect(order?.parts.every((p) => p.soldiers === 100 * FP)).toBe(true);
  });

  it('часть не меньше минимума: маленький отряд не дробится', () => {
    const orders = planExpansion(
      [{ id: 1, hex: 10, soldiers: 80 * FP }],
      [cell(11), cell(12), cell(9)],
      dist,
      MIN,
    );
    expect(orders[0]?.parts).toEqual([]);
  });

  it('вблизи врага (небезопасные гексы) отряд не делится, идёт целым', () => {
    const orders = planExpansion(
      [{ id: 1, hex: 10, soldiers: 300 * FP }],
      [cell(11), cell(12, 0, false), cell(9, 0, false)],
      dist,
      MIN,
    );
    expect(orders[0]?.parts).toEqual([]);
  });

  it('приоритет гекса сдвигает выбор: дыра в земле раньше гекса впереди, если не далеко', () => {
    const orders = planExpansion(
      [{ id: 1, hex: 10, soldiers: 60 * FP }],
      [cell(11, 15), cell(9, 3)],
      dist,
      MIN,
    );
    expect(orders[0]?.main).toBe(9);
  });
});
