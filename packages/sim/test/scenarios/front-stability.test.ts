import { describe, expect, it } from 'vitest';

import { hexFromId, distance } from '../../src/math/hex.ts';
import { SLOT_DETACHED } from '../../src/state/allocate.ts';
import { at, city, own, raw, scenario } from '../scenario/dsl.ts';

// Держать границу: отряды не бегают без нужды, а снятые ручным приказом возвращаются на линию.
// GDD: docs/gdd/07-controls.md — «Распределение», «Ручной приказ».

const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const FIELD = `
  a  a  a  a  b  b
  a  a  a  a  b  b
  a  a  a  a  b  b
  a  a  a  a  b  b
  a  a  a  a  b  b
  a  a  a  a  b  b
  a  a  a  a  b  b
  a  a  a  a  b  b
  a  a  a  a  b  b
  A1 a  a  a  b  B1
`;
const W = 6;

function holdWith(rows: readonly number[]) {
  const s = scenario(FIELD, { legend });
  const ids = rows.map((r) => s.unit('A', 'infantry', 300, at(2, r)));
  s.cmd('A', raw({ t: 'holdBorder', target: 1, soldiers: rows.length * 300 }));
  s.runTicks(600);
  const hexOf = (id: number): number => s.state.units.find((u) => u.id === id)?.hex ?? -1;
  return { s, ids, hexOf };
}

describe('держать: расстановка отрядов', () => {
  it('отряды, вставшие на линию, не бегают по ней дальше трёх гексов', () => {
    const { s, ids, hexOf } = holdWith([0, 2, 4, 6, 8]);
    const before = ids.map(hexOf);
    s.runTicks(1200);
    ids.forEach((id, i) => {
      expect(
        distance(hexFromId(hexOf(id), W), hexFromId(before[i] as number, W)),
      ).toBeLessThanOrEqual(3);
    });
  });

  it('повторное «Держать» не двигает отряды, уже стоящие на местах', () => {
    const { s, ids, hexOf } = holdWith([0, 3, 6, 9]);
    const before = ids.map(hexOf);
    s.cmd('A', raw({ t: 'holdBorder', target: 1, soldiers: 1200 }));
    s.runTicks(600);
    expect(ids.map(hexOf)).toEqual(before);
  });

  it('отряд после ручного приказа постоит и сам возвращается на линию армии', () => {
    const { s, ids, hexOf } = holdWith([0, 3, 6, 9]);
    const far = at(0, 5);
    s.cmd('A', raw({ t: 'move', unitIds: [ids[0] as number], to: far.col + far.row * W }));
    s.runTicks(100);
    const unit = s.state.units.find((u) => u.id === ids[0]);
    expect(unit?.slot).toBe(SLOT_DETACHED);
    s.runTicks(1000);
    expect(unit?.slot).not.toBe(SLOT_DETACHED);
    // Вернулся к границе: рядом со столбцом 3 (не остался у места приказа).
    expect(hexOf(ids[0] as number) % W).toBeGreaterThanOrEqual(2);
  });

  it('отряд в бою после ручного приказа с плана не возвращается', () => {
    const { s, ids } = holdWith([0, 3, 6, 9]);
    s.cmd('A', raw({ t: 'move', unitIds: [ids[0] as number], to: 30 }));
    s.runTicks(60);
    const unit = s.state.units.find((u) => u.id === ids[0]);
    if (unit) unit.inBattle = true;
    s.runTicks(1);
    expect(unit?.slot).toBe(SLOT_DETACHED);
  });
});
