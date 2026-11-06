import { describe, expect, it } from 'vitest';

import { FP } from '../../src/math/int.ts';
import { attachUnits } from '../../src/state/attach.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

// Две отдельные линии: гексы (0,0) и (4,0) не соседи.
const MAP = `
  A1 a  a  a  a
  a  a  a  a  a
  a  a  a  a  a
`;
const legend = { A1: city('A', 1, { capital: true }), a: own('A') };

describe('привязка отрядов к линиям (CR-002)', () => {
  it('скачок веса врага на одной линии не перегоняет отряды: доли ограничены, порог растёт с войском', () => {
    const s = scenario(MAP, { legend });
    const width = s.state.map.width;
    const left = 0 + 0 * width;
    const right = 4 + 0 * width;
    const ids = Array.from({ length: 12 }, (_, i) =>
      s.unit('A', 'infantry', 300, at(i < 6 ? 0 : 4, 0)),
    );
    const units = s.state.units.filter((u) => ids.includes(u.id));
    for (const u of units) u.slot = u.hex;
    // Вес врага у левой линии вырос в сто раз — раньше доля левой линии становилась почти всей армией.
    const weight = new Map([
      [left, 100 * FP],
      [right, FP],
    ]);
    const groups = attachUnits(s.state, [[left], [right]], weight, units);
    // Доля ограничена весом 3·FP на гекс, а перекос меньше четверти войска игнорируется: уходит не больше одного.
    expect(Math.abs((groups[0]?.length ?? 0) - 6)).toBeLessThanOrEqual(1);
    expect(Math.abs((groups[1]?.length ?? 0) - 6)).toBeLessThanOrEqual(1);
  });
});
